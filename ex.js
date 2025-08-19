 <!-- JS SECTION: Firebase, Data, Behaviors -->
  <!-- ===================================== -->
  <script type="module">
    // ===== Firebase (CDN Modules) =====
    // 1) Create a Firebase project, enable Authentication (Google + Email/Password), Firestore, Realtime Database, and Storage.
    // 2) Replace the config below and set security rules appropriately.
    import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
    import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, updateProfile } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
    import { getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, query, where, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
    import { getDatabase, ref as dbRef, onDisconnect, onValue, set as rtdbSet } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
    import { getStorage, ref as stRef, uploadBytes, getDownloadURL, listAll } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

    // ===== Replace with your Firebase project config =====
    const firebaseConfig = {
      apiKey: 'YOUR_API_KEY',
      authDomain: 'YOUR_AUTH_DOMAIN',
      projectId: 'YOUR_PROJECT_ID',
      storageBucket: 'YOUR_STORAGE_BUCKET',
      messagingSenderId: 'YOUR_MSG_SENDER_ID',
      appId: 'YOUR_APP_ID',
      databaseURL: 'YOUR_DB_URL'
    };

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const rtdb = getDatabase(app);
    const storage = getStorage(app);

    // ===== Utilities =====
    const $ = (sel) => document.querySelector(sel);
    const el = (tag, cls='') => { const e=document.createElement(tag); if(cls) e.className=cls; return e; };
    const uid = () => auth.currentUser?.uid;

    // ===== Welcome / Time =====
    $('#year').textContent = new Date().getFullYear();

    // ===== Auth: Google Sign-in & Roles =====
    const provider = new GoogleAuthProvider();
    $('#signInBtn').addEventListener('click', async () => {
      try { await signInWithPopup(auth, provider); } catch (e) { alert(e.message); }
    });
    $('#signOutBtn').addEventListener('click', async () => {
      await signOut(auth);
    });

    onAuthStateChanged(auth, async (user) => {
      const signedIn = !!user;
      $('#signInBtn').classList.toggle('hidden-el', signedIn);
      $('#signOutBtn').classList.toggle('hidden-el', !signedIn);
      $('#welcomeName').textContent = signedIn ? `Welcome, ${user.displayName || user.email}` : 'Welcome, Guest';
      $('#previewName').textContent = user?.displayName || 'Guest';
      $('#previewEmail').textContent = user?.email || 'Not signed in';
      $('#userAvatar').src = user?.photoURL || 'https://placehold.co/64x64';

      // Ensure user doc exists
      if (user) {
        const uref = doc(db, 'users', user.uid);
        const snap = await getDoc(uref);
        if (!snap.exists()) {
          await setDoc(uref, { email: user.email, name: user.displayName || '', role: 'user', membership: 'Free', createdAt: serverTimestamp() });
        }
        const data = (await getDoc(uref)).data();
        $('#accountRole').textContent = `role: ${data.role}`;
        $('#membershipTier').textContent = data.membership || 'Free';
        const isStaff = ['admin','moderator'].includes(data.role);
        $('#adminLink').classList.toggle('hidden-el', !isStaff);
        $('#newsEditorWrap').style.display = isStaff ? 'block' : 'none';
        setupPresence();
        initAllListeners();
      } else {
        setOfflineUI();
      }
    });

    function setOfflineUI(){
      $('#accountRole').textContent = 'role: guest';
      $('#membershipTier').textContent = 'Free';
      $('#adminLink').classList.add('hidden-el');
      $('#newsEditorWrap').style.display = 'none';
      $('#presenceText').textContent = 'offline';
      $('#presenceDot span')?.classList?.add('bg-slate-400');
    }

    // ===== Presence (Realtime DB) =====
    function setupPresence(){
      const user = auth.currentUser; if (!user) return;
      const statusRef = dbRef(rtdb, `/status/${user.uid}`);
      const isOnline = { state: 'online', last_changed: Date.now() };
      const isOffline = { state: 'offline', last_changed: Date.now() };
      rtdbSet(statusRef, isOnline);
      onDisconnect(statusRef).set(isOffline);
      onValue(statusRef, (snap)=>{
        const s = snap.val();
        const online = s?.state === 'online';
        $('#presenceText').textContent = online ? 'online' : 'offline';
        const dot = document.querySelector('#presenceDot span');
        dot.classList.toggle('bg-green-500', online);
        dot.classList.toggle('bg-slate-400', !online);
      });
    }

    // ===================================
    // LAUNCHER: Minimal WASM Boot Routine
    // ===================================
    async function loadWasm(url) {
      $('#wasmStatus').textContent = 'Fetching & instantiating...';
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch WASM');
        const results = await WebAssembly.instantiateStreaming(response, { env: { abort: ()=>{} } });
        // If your client needs a canvas/context, wire it here
        const canvas = document.getElementById('wasmCanvas');
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#10b981';
        ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = '16px sans-serif';
        ctx.fillText('WASM module loaded.', 10, 24);
        $('#wasmStatus').textContent = 'WASM loaded ✔';
        return results;
      } catch (e) {
        $('#wasmStatus').textContent = 'Error: ' + e.message;
      }
    }
    $('#loadWasmBtn').addEventListener('click', ()=>{
      const url = $('#wasmUrl').value.trim();
      if (!url) return alert('Enter .wasm URL');
      loadWasm(url);
    });

    // ===================================
    // CHAT: Channels, DMs, Messaging
    // ===================================
    let currentTarget = null; // { type: 'channel'|'dm', id: '...' }

    async function initAllListeners(){
      if (!auth.currentUser) return;
      listenChannels();
      listenDMs();
      listenIncomingRequests();
      listFriends();
      loadNews();
      loadRanks();
      listDownloads();
      listTickets();
      listThreads();
      if ((await getUserRole()) !== 'user') loadAdmin();
    }

    async function getUserRole(){
      const d = (await getDoc(doc(db,'users',uid()))).data();
      return d?.role || 'user';
    }

    // Channels
    async function listenChannels(){
      const qRef = query(collection(db,'channels'), orderBy('createdAt','asc'));
      onSnapshot(qRef, (snap)=>{
        const ul = $('#channelList'); ul.innerHTML='';
        snap.forEach(docu=>{
          const li = el('li', 'flex items-center justify-between');
          const a = el('button','px-2 py-1 hover:bg-slate-100 rounded-lg w-full text-left');
          a.textContent = '# ' + (docu.data().name || docu.id);
          a.onclick = ()=> selectTarget('channel', docu.id, a.textContent);
          li.appendChild(a);
          ul.appendChild(li);
        });
      });
    }
    $('#newChannelBtn').addEventListener('click', async ()=>{
      const name = prompt('Channel name'); if(!name) return;
      await addDoc(collection(db,'channels'), { name, createdAt: serverTimestamp() });
    });

    // DMs list is based on your friends
    async function listenDMs(){
      const dms = $('#dmList'); dms.innerHTML='';
      const flist = await getDocs(collection(db,'users',uid(),'friends'));
      flist.forEach(f=>{
        const li = el('li');
        const btn = el('button','px-2 py-1 hover:bg-slate-100 rounded-lg w-full text-left');
        btn.textContent = f.data().name || f.id;
        btn.onclick = ()=> selectTarget('dm', f.id, `@ ${btn.textContent}`);
        li.appendChild(btn);
        dms.appendChild(li);
      });
    }

    function selectTarget(type, id, label){
      currentTarget = { type, id };
      $('#activeTarget').textContent = label;
      listenMessages();
    }

    function messageColl(){
      if (!currentTarget) return null;
      if (currentTarget.type === 'channel') return collection(db,'channels',currentTarget.id,'messages');
      if (currentTarget.type === 'dm') {
        // deterministic chat id
        const pair = [uid(), currentTarget.id].sort().join('_');
        return collection(db,'dms',pair,'messages');
      }
    }

    function listenMessages(){
      const coll = messageColl(); if (!coll) return;
      const qRef = query(coll, orderBy('createdAt','asc'), limit(200));
      onSnapshot(qRef, (snap)=>{
        const list = $('#messageList'); list.innerHTML='';
        let unread = 0;
        snap.forEach(m=>{
          const d=m.data();
          const row = el('div','flex items-start gap-2');
          const avatar = el('img','h-8 w-8 rounded-full'); avatar.src=d.photoURL||'https://placehold.co/32';
          const bubble = el('div','bg-slate-100 rounded-2xl px-3 py-2'); bubble.innerHTML = `<div class='text-xs text-slate-500'>${d.author||'anon'} <span class='ml-2'>${d.createdAt?.toDate?.().toLocaleString?.()||''}</span></div><div>${d.text||''}</div>`;
          row.append(avatar,bubble);
          list.appendChild(row);
          if (!d.readBy?.includes(uid())) unread++;
        });
        $('#statsUnread').textContent = unread;
        list.scrollTop = list.scrollHeight;
      });
    }

    $('#sendMessageBtn').addEventListener('click', async ()=>{
      const input = $('#messageInput'); const text = input.value.trim(); if(!text||!currentTarget) return;
      const user = auth.currentUser;
      await addDoc(messageColl(), {
        text, author: user.displayName||user.email, uid: uid(), photoURL: user.photoURL||'', createdAt: serverTimestamp(), readBy: [uid()]
      });
      input.value='';
    });

    // ===================================
    // VOICE: Simple WebRTC 1:1 (Signaling via Firestore)
    // ===================================
    let pc = null; let localStream = null; let callUnsub = null;

    async function initPC(){
      pc = new RTCPeerConnection({ iceServers: [{urls:'stun:stun.l.google.com:19302'}] });
      localStream = await navigator.mediaDevices.getUserMedia({ audio:true, video:false });
      localStream.getTracks().forEach(t=>pc.addTrack(t, localStream));
      pc.ontrack = (e)=>{ $('#remoteAudio').srcObject = e.streams[0]; };
      pc.onicecandidate = async (ev)=>{
        if (ev.candidate && currentCallDoc) {
          await addDoc(collection(db,'calls',currentCallDoc.id,'candidates'), { from: uid(), candidate: ev.candidate.toJSON() });
        }
      };
    }

    let currentCallDoc = null;

    $('#startCallBtn').addEventListener('click', async ()=>{
      const peerUid = $('#callWithUid').value.trim(); if(!peerUid) return alert('Enter friend UID');
      await initPC();
      const callDoc = await addDoc(collection(db,'calls'), { a: uid(), b: peerUid, createdAt: serverTimestamp(), status:'ringing' });
      currentCallDoc = callDoc;
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      await setDoc(doc(db,'calls',callDoc.id), { a: uid(), b: peerUid, offer, createdAt: serverTimestamp(), status:'ringing' });
      callUnsub = onSnapshot(doc(db,'calls',callDoc.id), async (snap)=>{
        const data = snap.data();
        if (data?.answer && pc.signalingState !== 'stable') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
      });
      // Candidates
      onSnapshot(collection(db,'calls',callDoc.id,'candidates'), async (qs)=>{
        qs.docChanges().forEach(async (c)=>{
          const d=c.doc.data(); if (d.from!==uid() && d.candidate) {
            try { await pc.addIceCandidate(new RTCIceCandidate(d.candidate)); } catch(e){}
          }
        });
      });
      alert('Call started. The callee must open the app to auto-answer. (For production: implement call toast + accept button).');
    });

    // Auto-answer when a call targets me
    onSnapshot(query(collection(db,'calls'), where('b','==', uid()||'__none__'), where('status','==','ringing')), async (qs)=>{
      qs.forEach(async (docu)=>{
        if (currentCallDoc) return; // already in a call
        currentCallDoc = docu.ref;
        await initPC();
        const data = docu.data();
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
        await updateDoc(doc(db,'calls',docu.id), { answer, status:'connected' });
        onSnapshot(collection(db,'calls',docu.id,'candidates'), async (cs)=>{
          cs.docChanges().forEach(async (c)=>{
            const d=c.doc.data(); if (d.from!==uid() && d.candidate) {
              try { await pc.addIceCandidate(new RTCIceCandidate(d.candidate)); } catch(e){}
            }
          });
        });
      });
    });

    $('#hangupBtn').addEventListener('click', async ()=>{
      if (pc) { pc.getSenders().forEach(s=>s.track?.stop()); pc.close(); pc=null; }
      if (callUnsub) callUnsub(); currentCallDoc=null;
    });

    // ===================================
    // FRIENDS: Requests & Accept
    // ===================================
    $('#sendFriendReqBtn').addEventListener('click', async ()=>{
      const email = $('#friendEmail').value.trim(); if(!email) return;
      // find by email
      const qRef = query(collection(db,'users'), where('email','==',email));
      const snap = await getDocs(qRef);
      if (snap.empty) return alert('No user with that email');
      const target = snap.docs[0];
      await addDoc(collection(db,'users', target.id,'requests'), { from: uid(), fromEmail: auth.currentUser.email, createdAt: serverTimestamp() });
      alert('Request sent');
    });

    function listenIncomingRequests(){
      onSnapshot(collection(db,'users',uid(),'requests'), (qs)=>{
        const ul = $('#incomingRequests'); ul.innerHTML='';
        qs.forEach(r=>{
          const li = el('li','flex items-center justify-between');
          li.innerHTML = `<span>${r.data().fromEmail}</span>`;
          const act = el('div','flex gap-2');
          const a = el('button','btn text-xs'); a.textContent='Accept';
          a.onclick = async ()=>{
            await setDoc(doc(db,'users',uid(),'friends',r.data().from), { uid:r.data().from, name:r.data().fromEmail });
            await setDoc(doc(db,'users',r.data().from,'friends',uid()), { uid:uid(), name: auth.currentUser.email });
            await deleteDoc(doc(db,'users',uid(),'requests',r.id));
            listenDMs(); listFriends();
          };
          const d = el('button','btn text-xs'); d.textContent='Decline'; d.onclick = ()=> deleteDoc(doc(db,'users',uid(),'requests',r.id));
          act.append(a,d); li.appendChild(act); ul.appendChild(li);
        });
      });
    }

    async function listFriends(){
      const ul = $('#friendList'); ul.innerHTML='';
      const qs = await getDocs(collection(db,'users',uid(),'friends'));
      let count=0; qs.forEach(f=>{ count++; const li=el('li','card p-2 flex items-center justify-between'); li.innerHTML=`<span>${f.data().name}</span><span class='badge'>friend</span>`; ul.appendChild(li); });
      $('#statsFriends').textContent = count;
    }

    // ===================================
    // NEWS: Feed + Editor (Admin/Mod)
    // ===================================
    function loadNews(){
      const qRef = query(collection(db,'news'), orderBy('createdAt','desc'), limit(50));
      onSnapshot(qRef, (qs)=>{
        const ul = $('#newsFeed'); ul.innerHTML='';
        qs.forEach(n=>{
          const d=n.data();
          const li = el('li','card p-3');
          li.innerHTML = `<div class='text-sm text-slate-500'>${d.author||'system'} • ${d.createdAt?.toDate?.().toLocaleString?.()||''}</div><div class='font-semibold'>${d.title}</div><div class='prose prose-sm'>${(d.body||'').replace(/\n/g,'<br/>')}</div>`;
          ul.appendChild(li);
        });
      });
    }
    $('#postNewsBtn').addEventListener('click', ()=> publishNews('#newsTitle','#newsBody'));
    $('#adminPublishNewsBtn').addEventListener('click', ()=> publishNews('#adminNewsTitle','#adminNewsBody'));
    async function publishNews(tSel,bSel){
      const title=$(tSel).value.trim(); const body=$(bSel).value.trim(); if(!title||!body) return;
      await addDoc(collection(db,'news'), { title, body, author: auth.currentUser.displayName||auth.currentUser.email, createdAt: serverTimestamp() });
      $(tSel).value=''; $(bSel).value='';
    }

    // ===================================
    // STORE: Ranks & Perks + Membership
    // ===================================
    const RANKS = [
      { id:'Bronze', price: 4.99, perks:['Basic support','Forum badge','50MB storage'] },
      { id:'Silver', price: 9.99, perks:['Priority support','Custom emoji','1GB storage','Ad-free'] },
      { id:'Gold', price: 19.99, perks:['Early access','Profile banner','5GB storage','Boosted downloads'] },
      { id:'Platinum', price: 49.99, perks:['All perks','Moderator consideration','20GB storage','VIP voice quality'] },
    ];

    function loadRanks(){
      const grid = $('#ranksGrid'); grid.innerHTML='';
      RANKS.forEach(r=>{
        const card = el('div','card p-4 flex flex-col');
        card.innerHTML = `
          <div class='text-xl font-bold'>${r.id}</div>
          <div class='text-3xl font-extrabold my-2'>$${r.price}<span class='text-sm text-slate-500'>/mo</span></div>
          <ul class='text-sm space-y-1 mb-3'>${r.perks.map(p=>`<li class='flex items-center gap-2'><i class='bx bx-check text-green-600'></i>${p}</li>`).join('')}</ul>
          <button class='btn btn-primary mt-auto' data-rank='${r.id}'>Get ${r.id}</button>`;
        card.querySelector('button').addEventListener('click', ()=> purchaseRank(r.id));
        grid.appendChild(card);
      });
    }

    async function purchaseRank(rank){
      if (!auth.currentUser) return alert('Sign in first');
      // NOTE: Hook your payment gateway here. For demo we just set membership.
      await updateDoc(doc(db,'users',uid()), { membership: rank });
      $('#membershipTier').textContent = rank;
      alert(`Membership updated to ${rank}`);
    }

    // ===================================
    // DOWNLOADS: Upload & List from Storage
    // ===================================
    $('#uploadBtn').addEventListener('click', async ()=>{
      const f = $('#uploadFile').files[0]; if(!f) return;
      const path = `uploads/${uid()}/${Date.now()}_${f.name}`;
      await uploadBytes(stRef(storage, path), f);
      listDownloads();
    });
    async function listDownloads(){
      if (!auth.currentUser) return;
      const prefix = stRef(storage, `uploads/${uid()}`);
      try{
        const res = await listAll(prefix);
        const ul = $('#downloadList'); ul.innerHTML='';
        for(const item of res.items){
          const url = await getDownloadURL(item);
          const li = el('li','card p-2 flex items-center justify-between');
          li.innerHTML = `<span class='truncate max-w-[60%]'>${item.name}</span><a class='btn text-xs' href='${url}' download>Download</a>`;
          ul.appendChild(li);
        }
      }catch(e){ /* likely no files yet */ }
    }

    // ===================================
    // PROFILE: Display name & Avatar upload
    // ===================================
    $('#saveProfileBtn').addEventListener('click', async ()=>{
      if (!auth.currentUser) return alert('Sign in first');
      const name = $('#displayName').value.trim();
      let photoURL = auth.currentUser.photoURL || '';
      const file = $('#avatarFile').files[0];
      if (file) {
        const path = `avatars/${uid()}.jpg`;
        await uploadBytes(stRef(storage, path), file);
        photoURL = await getDownloadURL(stRef(storage, path));
      }
      await updateProfile(auth.currentUser, { displayName: name || auth.currentUser.displayName, photoURL });
      await updateDoc(doc(db,'users',uid()), { name: auth.currentUser.displayName, photoURL });
      $('#previewName').textContent = auth.currentUser.displayName;
      $('#userAvatar').src = photoURL || 'https://placehold.co/64x64';
      alert('Profile updated');
    });

    // ===================================
    // SUPPORT: Tickets
    // ===================================
    $('#openTicketBtn').addEventListener('click', async ()=>{
      if (!auth.currentUser) return alert('Sign in');
      const subject = $('#ticketSubject').value.trim();
      const body = $('#ticketBody').value.trim();
      if (!subject||!body) return;
      await addDoc(collection(db,'tickets'), { uid: uid(), subject, body, status:'open', createdAt: serverTimestamp() });
      $('#ticketSubject').value=''; $('#ticketBody').value='';
    });
    function listTickets(){
      if (!auth.currentUser) return;
      const qRef = query(collection(db,'tickets'), where('uid','==',uid()), orderBy('createdAt','desc'));
      onSnapshot(qRef, (qs)=>{
        const ul = $('#ticketList'); ul.innerHTML='';
        qs.forEach(t=>{
          const d=t.data();
          const li=el('li','card p-2');
          li.innerHTML = `<div class='font-semibold'>${d.subject} <span class='badge'>${d.status}</span></div><div class='text-sm text-slate-600'>${d.body}</div>`;
          ul.appendChild(li);
        });
      });
    }

    // ===================================
    // FORUMS: Threads + Posts (simplified)
    // ===================================
    $('#postThreadBtn').addEventListener('click', async ()=>{
      if (!auth.currentUser) return alert('Sign in');
      const title=$('#threadTitle').value.trim(); const body=$('#threadBody').value.trim();
      if(!title||!body) return;
      await addDoc(collection(db,'threads'), { title, body, author: auth.currentUser.displayName||auth.currentUser.email, uid: uid(), createdAt: serverTimestamp(), replies:0 });
      $('#threadTitle').value=''; $('#threadBody').value='';
    });
    function listThreads(){
      const qRef = query(collection(db,'threads'), orderBy('createdAt','desc'), limit(50));
      onSnapshot(qRef, (qs)=>{
        const ul = $('#threadList'); ul.innerHTML='';
        qs.forEach(th=>{
          const d=th.data();
          const li=el('li','card p-2');
          li.innerHTML = `<div class='font-semibold'>${d.title}</div><div class='text-sm text-slate-600 mb-2'>by ${d.author}</div><button class='btn text-xs' data-id='${th.id}'>Open</button>`;
          li.querySelector('button').onclick = ()=> openThread(th.id, d);
          ul.appendChild(li);
        });
      });
    }
    async function openThread(id, d){
      const modal = el('div','fixed inset-0 bg-black/40 grid place-items-center p-4');
      const box = el('div','card p-4 max-w-2xl w-full space-y-2');
      box.innerHTML = `<div class='flex items-center justify-between'><div class='text-xl font-bold'>${d.title}</div><button class='btn text-xs'>Close</button></div><div class='text-sm text-slate-700'>${d.body}</div><div id='postList' class='space-y-2 max-h-64 overflow-auto scroll-area'></div><div class='flex gap-2'><input id='replyInput' class='flex-1 border rounded-xl p-2' placeholder='Write a reply...'/><button id='replyBtn' class='btn btn-primary'>Reply</button></div>`;
      modal.appendChild(box); document.body.appendChild(modal);
      box.querySelector('.btn').onclick = ()=> modal.remove();
      const postsRef = collection(db,'threads',id,'posts');
      onSnapshot(query(postsRef, orderBy('createdAt','asc')), (qs)=>{
        const l = box.querySelector('#postList'); l.innerHTML='';
        qs.forEach(p=>{ const pd=p.data(); const div=el('div','bg-slate-100 rounded-xl px-3 py-2'); div.innerHTML=`<div class='text-xs text-slate-500'>${pd.author} • ${pd.createdAt?.toDate?.().toLocaleString?.()||''}</div><div>${pd.body}</div>`; l.appendChild(div); });
      });
      box.querySelector('#replyBtn').onclick = async ()=>{
        const val = box.querySelector('#replyInput').value.trim(); if(!val) return;
        await addDoc(postsRef,{ body:val, author: auth.currentUser.displayName||auth.currentUser.email, uid