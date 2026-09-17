import React, { useEffect, useRef, useState } from "react";
import CallWindow from "./callwindow";
import { supabase } from "./supabaseClient";

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  updateDoc,
} from "firebase/firestore";

import {
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";

import { auth, db, storage } from "./firebase";
import "./App.css";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState("login");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [searchEmail, setSearchEmail] = useState("");
  const [searchResult, setSearchResult] = useState(null);

  const [selectedUser, setSelectedUser] = useState(null);

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);

  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const [activeCall, setActiveCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);

  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [profile, setProfile] = useState(null);
  const [changingDp, setChangingDp] = useState(false);

  // Supabase Social Feed State
  const [activeTab, setActiveTab] = useState("chat"); // "chat" or "feed"
  const [posts, setPosts] = useState([]);
  const [newPostContent, setNewPostContent] = useState("");

  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const profileInputRef = useRef(null);

  /* =====================================================
      AUTH & SUPABASE FEED INIT
  ===================================================== */

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setLoading(false);

      if (!currentUser) {
        setProfile(null);
        return;
      }

      try {
        const userRef = doc(db, "users", currentUser.uid);
        const existing = await getDoc(userRef);

        const userData = {
          uid: currentUser.uid,
          name:
            currentUser.displayName ||
            currentUser.email?.split("@")[0] ||
            "User",
          email: currentUser.email?.toLowerCase(),
          online: true,
          lastSeen: serverTimestamp(),
        };

        if (!existing.exists()) {
          userData.createdAt = serverTimestamp();
        }

        await setDoc(userRef, userData, { merge: true });

        const updatedSnapshot = await getDoc(userRef);
        if (updatedSnapshot.exists()) {
          setProfile(updatedSnapshot.data());
        }
      } catch (err) {
        console.error("Profile loading error:", err);
      }
    });

    fetchSupabasePosts();

    return () => unsubscribe();
  }, []);

  /* =====================================================
      SUPABASE SOCIAL FEED FUNCTIONS
  ===================================================== */

  const fetchSupabasePosts = async () => {
    try {
      const { data, error } = await supabase
        .from("posts")
        .select("*")
        .order("created_at", { ascending: false });
      if (data) setPosts(data);
    } catch (err) {
      console.error("Supabase post fetch error:", err);
    }
  };

  const handleCreateSupabasePost = async (e) => {
    e.preventDefault();
    if (!newPostContent.trim() || !user) return;

    const userName = profile?.name || user.displayName || user.email?.split("@")[0];
    const userAvatar = profile?.photoURL || "";

    const { error } = await supabase.from("posts").insert([
      {
        user_id: user.uid,
        user_name: userName,
        user_avatar: userAvatar,
        content: newPostContent.trim(),
      },
    ]);

    if (error) {
      setError("Post could not be shared: " + error.message);
    } else {
      setNewPostContent("");
      fetchSupabasePosts();
    }
  };

  /* =====================================================
      KEEP USER ONLINE
  ===================================================== */

  useEffect(() => {
    if (!user) return;

    const handleBeforeUnload = () => {
      setDoc(
        doc(db, "users", user.uid),
        {
          online: false,
          lastSeen: serverTimestamp(),
        },
        { merge: true }
      );
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [user]);

  /* =====================================================
      INCOMING CALL
  ===================================================== */

  useEffect(() => {
    if (!user) return;

    const callsRef = collection(db, "calls");
    const q = query(callsRef, where("receiver", "==", user.uid));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        let latestCall = null;

        snapshot.forEach((item) => {
          const data = item.data();

          if (data.status === "ringing" && data.caller !== user.uid) {
            latestCall = {
              callId: item.id,
              ...data,
            };
          }
        });

        setIncomingCall(latestCall);
      },
      (err) => {
        console.error("Incoming call:", err);
      }
    );

    return () => unsubscribe();
  }, [user]);

  /* =====================================================
      REGISTER & LOGIN
  ===================================================== */

  const register = async (e) => {
    e.preventDefault();
    setError("");

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName || !cleanEmail || password.length < 6) {
      setError("Please fill all details correctly.");
      return;
    }

    try {
      const result = await createUserWithEmailAndPassword(auth, cleanEmail, password);
      await updateProfile(result.user, { displayName: cleanName });
      await setDoc(doc(db, "users", result.user.uid), {
        uid: result.user.uid,
        name: cleanName,
        email: cleanEmail,
        online: true,
        lastSeen: serverTimestamp(),
        createdAt: serverTimestamp(),
        photoURL: "",
      }, { merge: true });

      setName("");
      setPassword("");
    } catch (err) {
      setError(getFirebaseError(err));
    }
  };

  const login = async (e) => {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      setPassword("");
    } catch (err) {
      setError(getFirebaseError(err));
    }
  };

  const getFirebaseError = (err) => {
    switch (err?.code) {
      case "auth/invalid-credential": return "Email or password is incorrect.";
      case "auth/user-not-found": return "No account found with this email.";
      case "auth/wrong-password": return "Incorrect password.";
      case "auth/email-already-in-use": return "This email is already registered.";
      default: return err?.message || "Something went wrong.";
    }
  };

  const logout = async () => {
    try {
      if (user) {
        await setDoc(doc(db, "users", user.uid), { online: false, lastSeen: serverTimestamp() }, { merge: true });
      }
      await signOut(auth);
      setSelectedUser(null);
      setMessages([]);
      setActiveCall(null);
      setIncomingCall(null);
      setSearchResult(null);
      setProfile(null);
    } catch (err) {
      console.error(err);
    }
  };

  /* =====================================================
      SEARCH & CHAT
  ===================================================== */

  const searchUser = async () => {
    setError("");
    setSearchResult(null);
    const value = searchEmail.trim().toLowerCase();

    if (!value) return;
    if (value === user?.email?.toLowerCase()) {
      setError("You cannot chat with yourself.");
      return;
    }

    try {
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("email", "==", value));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setError("No PawanKChat user found.");
        return;
      }
      setSearchResult(snapshot.docs[0].data());
    } catch (err) {
      setError(err.message);
    }
  };

  const getChatId = (uid1, uid2) => [uid1, uid2].sort().join("_");

  const openChat = (otherUser) => {
    setSelectedUser(otherUser);
    setSearchResult(null);
    setSearchEmail("");
    setMessages([]);
    setError("");

    const chatId = getChatId(user.uid, otherUser.uid);
    const messagesRef = collection(db, "chats", chatId, "messages");
    const q = query(messagesRef, orderBy("createdAt", "asc"));

    onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      setMessages(list);
    });
  };

  const saveMessage = async (data) => {
    if (!selectedUser || !user) return;
    const chatId = getChatId(user.uid, selectedUser.uid);

    await setDoc(doc(db, "chats", chatId), {
      users: [user.uid, selectedUser.uid],
      updatedAt: serverTimestamp(),
      lastMessage: data.text || data.fileName || "Attachment",
    }, { merge: true });

    await addDoc(collection(db, "chats", chatId, "messages"), {
      ...data,
      senderId: user.uid,
      receiverId: selectedUser.uid,
      createdAt: serverTimestamp(),
      status: "sent",
    });
  };

  const sendMessage = async () => {
    if (!message.trim() || !selectedUser || sending) return;
    setSending(true);
    setError("");

    try {
      await saveMessage({ type: "text", text: message.trim() });
      setMessage("");
    } catch (err) {
      setError(err.message);
    }
    setSending(false);
  };

  /* =====================================================
      CALL HANDLERS & FILES
  ===================================================== */

  const startCall = async (type) => {
    if (!user || !selectedUser || activeCall || incomingCall) return;
    try {
      const callRef = await addDoc(collection(db, "calls"), {
        caller: user.uid,
        receiver: selectedUser.uid,
        callerName: profile?.name || user.displayName || "User",
        receiverName: selectedUser.name || "User",
        type,
        status: "ringing",
        createdAt: serverTimestamp(),
      });
      setActiveCall({ callId: callRef.id, caller: user.uid, receiver: selectedUser.uid, type, isCaller: true });
    } catch (err) {
      setError("Call could not start.");
    }
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    await updateDoc(doc(db, "calls", incomingCall.callId), { status: "accepted" });
    setActiveCall({ ...incomingCall, isCaller: false });
    setIncomingCall(null);
  };

  const rejectCall = async () => {
    if (!incomingCall) return;
    await updateDoc(doc(db, "calls", incomingCall.callId), { status: "rejected" });
    setIncomingCall(null);
  };

  const endCall = async () => {
    if (!activeCall) return;
    await updateDoc(doc(db, "calls", activeCall.callId), { status: "ended" });
    setActiveCall(null);
  };

  if (loading) {
    return (
      <div className="auth-page">
        <div className="loading-card">
          <div className="loading-logo">💬</div>
          <h1>PawanKChat</h1>
          <div className="loading-spinner"></div>
          <p>Connecting securely...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-page">
        <div className="auth-container">
          <section className="auth-card">
            <h2>{mode === "login" ? "Sign in" : "Create account"}</h2>
            <form onSubmit={mode === "login" ? login : register}>
              {mode === "register" && (
                <input type="text" placeholder="Full Name" value={name} onChange={(e) => setName(e.target.value)} />
              )}
              <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
              {error && <p style={{ color: "red" }}>{error}</p>}
              <button type="submit">{mode === "login" ? "Sign In" : "Register"}</button>
            </form>
            <button onClick={() => setMode(mode === "login" ? "register" : "login")}>
              Switch to {mode === "login" ? "Register" : "Login"}
            </button>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h2>PawanKChat</h2>
        </div>
        <div style={{ display: "flex", gap: 5, padding: 10 }}>
          <button 
            style={{ flex: 1, padding: 8, background: activeTab === 'chat' ? '#0d9488' : '#ccc', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}
            onClick={() => setActiveTab('chat')}
          >
            Chats & Calls
          </button>
          <button 
            style={{ flex: 1, padding: 8, background: activeTab === 'feed' ? '#0d9488' : '#ccc', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}
            onClick={() => { setActiveTab('feed'); fetchSupabasePosts(); }}
          >
            Social Feed
          </button>
        </div>

        {activeTab === "chat" && (
          <>
            <div className="search-box">
              <input type="email" placeholder="Search user..." value={searchEmail} onChange={(e) => setSearchEmail(e.target.value)} />
              <button onClick={searchUser}>Search</button>
            </div>
            {searchResult && (
              <div className="chat-user" onClick={() => openChat(searchResult)}>
                <strong>{searchResult.name}</strong>
              </div>
            )}
            {selectedUser && (
              <div className="chat-user active" onClick={() => openChat(selectedUser)}>
                <strong>{selectedUser.name}</strong>
              </div>
            )}
          </>
        )}

        <div className="side-bottom">
          <button className="logout-btn" onClick={logout}>Logout</button>
        </div>
      </aside>

      <main className="chat-area">
        {activeTab === "feed" ? (
          <div style={{ padding: 20, overflowY: "auto", height: "100%" }}>
            <h2>Social Feed (Supabase)</h2>
            <form onSubmit={handleCreateSupabasePost} style={{ marginBottom: 20 }}>
              <textarea
                value={newPostContent}
                onChange={(e) => setNewPostContent(e.target.value)}
                placeholder="आज आप क्या शेयर करना चाहते हैं?"
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                rows={3}
              />
              <button style={{ marginTop: 8, padding: "8px 16px", background: "#0d9488", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
                Post शेयर करें
              </button>
            </form>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {posts.map((post) => (
                <div key={post.id} style={{ background: "#fff", padding: 12, borderRadius: 8, border: "1px solid #ddd" }}>
                  <strong>{post.user_name}</strong>
                  <p>{post.content}</p>
                  <small style={{ color: "#888" }}>{new Date(post.created_at).toLocaleTimeString()}</small>
                </div>
              ))}
            </div>
          </div>
        ) : !selectedUser ? (
          <div className="empty-chat">
            <h1>Welcome to PawanKChat</h1>
            <p>Select or search a user to start 1-on-1 chatting or calling!</p>
          </div>
        ) : (
          <>
            <header className="chat-header">
              <h3>{selectedUser.name}</h3>
              <div>
                <button onClick={() => startCall("audio")}>📞 Call</button>
                <button onClick={() => startCall("video")}>🎥 Video</button>
              </div>
            </header>

            <section className="messages">
              {messages.map((msg) => (
                <div key={msg.id} className={`message-row ${msg.senderId === user.uid ? "mine" : "theirs"}`}>
                  <div className="message-bubble">
                    <p>{msg.text}</p>
                  </div>
                </div>
              ))}
            </section>

            <footer className="composer">
              <input
                type="text"
                placeholder="Type a message..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              />
              <button onClick={sendMessage}>➤</button>
            </footer>
          </>
        )}
      </main>

      {incomingCall && !activeCall && (
        <div className="incoming-call-overlay">
          <h2>{incomingCall.callerName} Calling...</h2>
          <button onClick={acceptCall}>Accept</button>
          <button onClick={rejectCall}>Decline</button>
        </div>
      )}

      {activeCall && (
        <CallWindow
          callId={activeCall.callId}
          caller={activeCall.caller}
          receiver={activeCall.receiver}
          isCaller={activeCall.isCaller}
          type={activeCall.type}
          onEnd={endCall}
        />
      )}
    </div>
  );
}

export default App;