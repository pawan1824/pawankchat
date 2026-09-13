import { useEffect, useRef, useState } from "react";
import CallWindow from "./callwindow";

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

  const [showAttachmentMenu, setShowAttachmentMenu] =
    useState(false);

  const [uploading, setUploading] = useState(false);

  const [profile, setProfile] = useState(null);
  const [changingDp, setChangingDp] = useState(false);

  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const profileInputRef = useRef(null);

  /* =====================================================
     AUTH
  ===================================================== */

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        setUser(currentUser);
        setLoading(false);

        if (!currentUser) {
          setProfile(null);
          return;
        }

        try {
          const userRef = doc(
            db,
            "users",
            currentUser.uid
          );

          const existing = await getDoc(userRef);

          const userData = {
            uid: currentUser.uid,
            name:
              currentUser.displayName ||
              currentUser.email?.split("@")[0] ||
              "User",
            email:
              currentUser.email?.toLowerCase(),
            online: true,
            lastSeen: serverTimestamp(),
          };

          if (!existing.exists()) {
            userData.createdAt =
              serverTimestamp();
          }

          await setDoc(
            userRef,
            userData,
            { merge: true }
          );

          const updatedSnapshot =
            await getDoc(userRef);

          if (updatedSnapshot.exists()) {
            setProfile(
              updatedSnapshot.data()
            );
          }
        } catch (err) {
          console.error(
            "Profile loading error:",
            err
          );
        }
      }
    );

    return () => unsubscribe();
  }, []);

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

    window.addEventListener(
      "beforeunload",
      handleBeforeUnload
    );

    return () => {
      window.removeEventListener(
        "beforeunload",
        handleBeforeUnload
      );
    };
  }, [user]);

  /* =====================================================
     INCOMING CALL
  ===================================================== */

  useEffect(() => {
    if (!user) return;

    const callsRef = collection(db, "calls");

    const q = query(
      callsRef,
      where("receiver", "==", user.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        let latestCall = null;

        snapshot.forEach((item) => {
          const data = item.data();

          if (
            data.status === "ringing" &&
            data.caller !== user.uid
          ) {
            latestCall = {
              callId: item.id,
              ...data,
            };
          }
        });

        setIncomingCall(latestCall);
      },
      (err) => {
        console.error(
          "Incoming call:",
          err
        );
      }
    );

    return () => unsubscribe();
  }, [user]);

  /* =====================================================
     REGISTER
  ===================================================== */

  const register = async (e) => {
    e.preventDefault();
    setError("");

    const cleanName = name.trim();
    const cleanEmail =
      email.trim().toLowerCase();

    if (!cleanName) {
      setError("Please enter your name.");
      return;
    }

    if (!cleanEmail) {
      setError("Please enter your email.");
      return;
    }

    if (password.length < 6) {
      setError(
        "Password must be at least 6 characters."
      );
      return;
    }

    try {
      const result =
        await createUserWithEmailAndPassword(
          auth,
          cleanEmail,
          password
        );

      await updateProfile(
        result.user,
        {
          displayName: cleanName,
        }
      );

      await setDoc(
        doc(
          db,
          "users",
          result.user.uid
        ),
        {
          uid: result.user.uid,
          name: cleanName,
          email: cleanEmail,
          online: true,
          lastSeen: serverTimestamp(),
          createdAt: serverTimestamp(),
          photoURL: "",
        },
        { merge: true }
      );

      setName("");
      setPassword("");
    } catch (err) {
      setError(
        getFirebaseError(err)
      );
    }
  };

  /* =====================================================
     LOGIN
  ===================================================== */

  const login = async (e) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError(
        "Please enter your email."
      );
      return;
    }

    if (!password) {
      setError(
        "Please enter your password."
      );
      return;
    }

    try {
      await signInWithEmailAndPassword(
        auth,
        email.trim().toLowerCase(),
        password
      );

      setPassword("");
    } catch (err) {
      setError(
        getFirebaseError(err)
      );
    }
  };

  /* =====================================================
     FIREBASE ERROR
  ===================================================== */

  const getFirebaseError = (err) => {
    switch (err?.code) {
      case "auth/invalid-credential":
        return "Email or password is incorrect.";

      case "auth/user-not-found":
        return "No account found with this email.";

      case "auth/wrong-password":
        return "Incorrect password.";

      case "auth/email-already-in-use":
        return "This email is already registered.";

      case "auth/invalid-email":
        return "Please enter a valid email.";

      case "auth/weak-password":
        return "Password must be at least 6 characters.";

      case "auth/too-many-requests":
        return "Too many attempts. Please try again later.";

      default:
        return (
          err?.message ||
          "Something went wrong."
        );
    }
  };

  /* =====================================================
     LOGOUT
  ===================================================== */

  const logout = async () => {
    try {
      if (user) {
        await setDoc(
          doc(db, "users", user.uid),
          {
            online: false,
            lastSeen: serverTimestamp(),
          },
          { merge: true }
        );
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
     SEARCH USER
  ===================================================== */

  const searchUser = async () => {
    setError("");
    setSearchResult(null);

    const value =
      searchEmail.trim().toLowerCase();

    if (!value) {
      setError(
        "Enter an email to search."
      );
      return;
    }

    if (
      value ===
      user?.email?.toLowerCase()
    ) {
      setError(
        "You cannot chat with yourself."
      );
      return;
    }

    try {
      const usersRef =
        collection(db, "users");

      const q = query(
        usersRef,
        where("email", "==", value)
      );

      const snapshot =
        await getDocs(q);

      if (snapshot.empty) {
        setError(
          "No PawanKChat user found."
        );
        return;
      }

      setSearchResult(
        snapshot.docs[0].data()
      );
    } catch (err) {
      setError(err.message);
    }
  };

  /* =====================================================
     CHAT ID
  ===================================================== */

  const getChatId = (
    uid1,
    uid2
  ) => {
    return [uid1, uid2]
      .sort()
      .join("_");
  };

  /* =====================================================
     OPEN CHAT
  ===================================================== */

  const openChat = (otherUser) => {
    setSelectedUser(otherUser);
    setSearchResult(null);
    setSearchEmail("");
    setMessages([]);
    setError("");

    const chatId = getChatId(
      user.uid,
      otherUser.uid
    );

    const messagesRef =
      collection(
        db,
        "chats",
        chatId,
        "messages"
      );

    const q = query(
      messagesRef,
      orderBy(
        "createdAt",
        "asc"
      )
    );

    onSnapshot(
      q,
      (snapshot) => {
        const list =
          snapshot.docs.map(
            (item) => ({
              id: item.id,
              ...item.data(),
            })
          );

        setMessages(list);
      },
      (err) => {
        console.error(
          "Messages:",
          err
        );
      }
    );
  };

  /* =====================================================
     SAVE MESSAGE
  ===================================================== */

  const saveMessage = async (
    data
  ) => {
    if (
      !selectedUser ||
      !user
    ) {
      return;
    }

    const chatId =
      getChatId(
        user.uid,
        selectedUser.uid
      );

    await setDoc(
      doc(
        db,
        "chats",
        chatId
      ),
      {
        users: [
          user.uid,
          selectedUser.uid,
        ],
        updatedAt:
          serverTimestamp(),
        lastMessage:
          data.text ||
          data.fileName ||
          "Attachment",
      },
      { merge: true }
    );

    await addDoc(
      collection(
        db,
        "chats",
        chatId,
        "messages"
      ),
      {
        ...data,
        senderId: user.uid,
        receiverId:
          selectedUser.uid,
        createdAt:
          serverTimestamp(),
        status: "sent",
      }
    );
  };

  /* =====================================================
     SEND TEXT MESSAGE
  ===================================================== */

  const sendMessage = async () => {
    if (
      !message.trim() ||
      !selectedUser ||
      sending
    ) {
      return;
    }

    setSending(true);
    setError("");

    try {
      await saveMessage({
        type: "text",
        text: message.trim(),
      });

      setMessage("");
    } catch (err) {
      setError(err.message);
    }

    setSending(false);
  };

  /* =====================================================
     UPLOAD FILE
  ===================================================== */

  const uploadChatFile = async (
    file,
    fileType
  ) => {
    if (
      !file ||
      !user ||
      !selectedUser
    ) {
      return;
    }

    const maxSize =
      25 * 1024 * 1024;

    if (file.size > maxSize) {
      setError(
        "File size maximum 25MB hai."
      );
      return;
    }

    setUploading(true);
    setError("");
    setShowAttachmentMenu(false);

    try {
      const safeName =
        file.name.replace(
          /[^a-zA-Z0-9._-]/g,
          "_"
        );

      const storagePath =
        `chatFiles/${user.uid}/${Date.now()}_${safeName}`;

      const storageRef =
        ref(
          storage,
          storagePath
        );

      await uploadBytes(
        storageRef,
        file
      );

      const downloadURL =
        await getDownloadURL(
          storageRef
        );

      await saveMessage({
        type: fileType,
        text:
          fileType === "image"
            ? ""
            : file.name,
        fileName: file.name,
        fileSize: file.size,
        fileType:
          file.type ||
          "application/octet-stream",
        fileURL:
          downloadURL,
      });
    } catch (err) {
      console.error(
        "Upload error:",
        err
      );

      setError(
        "File upload failed: " +
          (err?.message ||
            "Unknown error")
      );
    }

    setUploading(false);
  };

  /* =====================================================
     IMAGE SELECT
  ===================================================== */

  const handleImageSelect = async (
    e
  ) => {
    const file =
      e.target.files?.[0];

    e.target.value = "";

    if (!file) return;

    if (
      !file.type.startsWith(
        "image/"
      )
    ) {
      setError(
        "Please select an image."
      );
      return;
    }

    await uploadChatFile(
      file,
      "image"
    );
  };

  /* =====================================================
     FILE SELECT
  ===================================================== */

  const handleFileSelect = async (
    e
  ) => {
    const file =
      e.target.files?.[0];

    e.target.value = "";

    if (!file) return;

    await uploadChatFile(
      file,
      "file"
    );
  };

  /* =====================================================
     PROFILE DP
  ===================================================== */

  const changeProfilePhoto = async (
    e
  ) => {
    const file =
      e.target.files?.[0];

    e.target.value = "";

    if (!file || !user) return;

    if (
      !file.type.startsWith(
        "image/"
      )
    ) {
      setError(
        "Please select an image for DP."
      );
      return;
    }

    if (
      file.size >
      5 * 1024 * 1024
    ) {
      setError(
        "Profile photo maximum 5MB hai."
      );
      return;
    }

    setChangingDp(true);
    setError("");

    try {
      const storageRef =
        ref(
          storage,
          `profilePhotos/${user.uid}/profile.jpg`
        );

      await uploadBytes(
        storageRef,
        file
      );

      const photoURL =
        await getDownloadURL(
          storageRef
        );

      await updateProfile(
        user,
        {
          photoURL,
        }
      );

      await setDoc(
        doc(
          db,
          "users",
          user.uid
        ),
        {
          photoURL,
          name:
            profile?.name ||
            user.displayName ||
            user.email?.split(
              "@"
            )[0],
        },
        { merge: true }
      );

      setProfile(
        (old) => ({
          ...(old || {}),
          photoURL,
        })
      );
    } catch (err) {
      console.error(
        "DP error:",
        err
      );

      setError(
        "Profile photo update failed."
      );
    }

    setChangingDp(false);
  };

  /* =====================================================
     START CALL
  ===================================================== */

  const startCall = async (
    type
  ) => {
    if (
      !user ||
      !selectedUser ||
      activeCall ||
      incomingCall
    ) {
      return;
    }

    try {
      const callRef =
        await addDoc(
          collection(
            db,
            "calls"
          ),
          {
            caller: user.uid,
            receiver:
              selectedUser.uid,
            callerName:
              profile?.name ||
              user.displayName ||
              user.email?.split(
                "@"
              )[0] ||
              "User",
            receiverName:
              selectedUser.name ||
              "User",
            type,
            status: "ringing",
            createdAt:
              serverTimestamp(),
          }
        );

      setActiveCall({
        callId:
          callRef.id,
        caller:
          user.uid,
        receiver:
          selectedUser.uid,
        type,
        isCaller: true,
      });
    } catch (err) {
      console.error(err);

      setError(
        "Call could not start: " +
          getFirebaseError(err)
      );
    }
  };

  /* =====================================================
     ACCEPT CALL
  ===================================================== */

  const acceptCall = async () => {
    if (!incomingCall)
      return;

    try {
      await updateDoc(
        doc(
          db,
          "calls",
          incomingCall.callId
        ),
        {
          status:
            "accepted",
        }
      );

      setActiveCall({
        ...incomingCall,
        isCaller: false,
      });

      setIncomingCall(null);
    } catch (err) {
      setError(err.message);
    }
  };

  /* =====================================================
     REJECT CALL
  ===================================================== */

  const rejectCall = async () => {
    if (!incomingCall)
      return;

    try {
      await updateDoc(
        doc(
          db,
          "calls",
          incomingCall.callId
        ),
        {
          status:
            "rejected",
        }
      );
    } catch (err) {
      console.error(err);
    }

    setIncomingCall(null);
  };

  /* =====================================================
     END CALL
  ===================================================== */

  const endCall = async () => {
    if (!activeCall)
      return;

    try {
      await updateDoc(
        doc(
          db,
          "calls",
          activeCall.callId
        ),
        {
          status: "ended",
        }
      );
    } catch (err) {
      console.error(err);
    }

    setActiveCall(null);
  };

  /* =====================================================
     FORMAT FILE SIZE
  ===================================================== */

  const formatFileSize = (
    bytes
  ) => {
    if (!bytes) return "";

    if (bytes < 1024)
      return `${bytes} B`;

    if (
      bytes <
      1024 * 1024
    ) {
      return `${(
        bytes / 1024
      ).toFixed(1)} KB`;
    }

    return `${(
      bytes /
      (1024 * 1024)
    ).toFixed(1)} MB`;
  };

  /* =====================================================
     URL DETECTION
  ===================================================== */

  const renderText = (
    text
  ) => {
    if (!text) return null;

    const parts =
      text.split(
        /(https?:\/\/[^\s]+)/g
      );

    return parts.map(
      (part, index) => {
        if (
          part.startsWith(
            "http://"
          ) ||
          part.startsWith(
            "https://"
          )
        ) {
          return (
            <a
              key={index}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
            >
              {part}
            </a>
          );
        }
        if (
          part.startsWith("http://") ||
          part.startsWith("https://")
        ) {
          return (
            <a
              key={index}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
            >
              {part}
            </a>
          );
        }

        return (
          <span key={index}>
            {part}
          </span>
        );
      }
    );
  };

  /* =====================================================
     LOADING SCREEN
  ===================================================== */

  if (loading) {
    return (
      <div className="auth-page">
        <div className="loading-card">
          <div className="loading-logo">
            💬
          </div>

          <h1>PawanKChat</h1>

          <div className="loading-spinner"></div>

          <p>Connecting securely...</p>
        </div>
      </div>
    );
  }

  /* =====================================================
     LOGIN / REGISTER
  ===================================================== */

  if (!user) {
    return (
      <div className="auth-page">

        <div className="auth-orb orb-one"></div>
        <div className="auth-orb orb-two"></div>
        <div className="auth-orb orb-three"></div>

        <div className="auth-container">

          {/* BRAND */}

          <section className="auth-brand">

            <div className="brand-logo-large">
              💬
            </div>

            <div className="brand-name">
              PawanKChat
            </div>

            <div className="brand-line"></div>

            <h1>
              Connect with
              <br />
              <span>your people.</span>
            </h1>

            <p className="brand-description">
              Simple, private and real-time
              communication for everyone.
            </p>

            <div className="feature-list">

              <div className="feature-item">
                <span className="feature-icon">
                  ✓
                </span>

                <div>
                  <strong>
                    Real-time Chat
                  </strong>

                  <small>
                    Messages delivered instantly
                  </small>
                </div>
              </div>

              <div className="feature-item">
                <span className="feature-icon">
                  ◉
                </span>

                <div>
                  <strong>
                    Audio & Video Calls
                  </strong>

                  <small>
                    Talk face-to-face anywhere
                  </small>
                </div>
              </div>

              <div className="feature-item">
                <span className="feature-icon">
                  🔒
                </span>

                <div>
                  <strong>
                    Private & Secure
                  </strong>

                  <small>
                    Your conversations stay private
                  </small>
                </div>
              </div>

              <div className="feature-item">
                <span className="feature-icon">
                  📎
                </span>

                <div>
                  <strong>
                    File & Photo Sharing
                  </strong>

                  <small>
                    Share images and files easily
                  </small>
                </div>
              </div>

            </div>

          </section>

          {/* AUTH CARD */}

          <section className="auth-card">

            <div className="mobile-logo">
              💬
            </div>

            <div className="auth-card-header">

              <div className="auth-eyebrow">
                {mode === "login"
                  ? "WELCOME BACK"
                  : "GET STARTED"}
              </div>

              <h2>
                {mode === "login"
                  ? "Sign in"
                  : "Create account"}
              </h2>

              <p>
                {mode === "login"
                  ? "Enter your details to continue."
                  : "Create your free PawanKChat account."}
              </p>

            </div>

            <form
              className="auth-form"
              onSubmit={
                mode === "login"
                  ? login
                  : register
              }
            >

              {mode === "register" && (
                <div className="input-group">

                  <label>
                    Full name
                  </label>

                  <div className="input-wrapper">

                    <span>👤</span>

                    <input
                      type="text"
                      placeholder="Enter your name"
                      value={name}
                      onChange={(e) =>
                        setName(e.target.value)
                      }
                    />

                  </div>

                </div>
              )}

              <div className="input-group">

                <label>
                  Email address
                </label>

                <div className="input-wrapper">

                  <span>✉</span>

                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) =>
                      setEmail(e.target.value)
                    }
                  />

                </div>

              </div>

              <div className="input-group">

                <label>
                  Password
                </label>

                <div className="input-wrapper">

                  <span>🔒</span>

                  <input
                    type={
                      showPassword
                        ? "text"
                        : "password"
                    }
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) =>
                      setPassword(e.target.value)
                    }
                  />

                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() =>
                      setShowPassword(
                        !showPassword
                      )
                    }
                  >
                    {showPassword
                      ? "🙈"
                      : "👁"}
                  </button>

                </div>

              </div>

              {error && (
                <div className="auth-error">

                  <span>!</span>

                  <p>{error}</p>

                </div>
              )}

              <button
                className="auth-submit"
                type="submit"
              >

                <span>
                  {mode === "login"
                    ? "Sign in"
                    : "Create account"}
                </span>

                <b>→</b>

              </button>

            </form>

            <div className="auth-divider">
              <span>OR</span>
            </div>

            <button
              type="button"
              className="switch-auth"
              onClick={() => {
                setMode(
                  mode === "login"
                    ? "register"
                    : "login"
                );

                setError("");
                setShowPassword(false);
              }}
            >
              {mode === "login"
                ? "Don't have an account?"
                : "Already have an account?"}

              <strong>
                {mode === "login"
                  ? " Create one"
                  : " Sign in"}
              </strong>

            </button>

            <div className="auth-footer">
              <span>🔐</span>
              Your connection is protected
            </div>

          </section>

        </div>

      </div>
    );
  }

  /* =====================================================
     MAIN APP
  ===================================================== */

  return (
    <div className="app">

      {/* =================================================
          SIDEBAR
      ================================================= */}

      <aside className="sidebar">

        {/* BRAND */}

        <div className="brand">

          <div className="brand-icon">
            💬
          </div>

          <div>
            <h2>
              PawanKChat
            </h2>

            <span>
              Private & Secure
            </span>
          </div>

        </div>

        {/* PROFILE */}

        <div className="profile">

          <button
            type="button"
            className="avatar avatar-button"
            onClick={() =>
              profileInputRef.current?.click()
            }
            title="Change profile photo"
          >

            {profile?.photoURL ? (
              <img
                src={profile.photoURL}
                alt="Profile"
              />
            ) : (
              (
                profile?.name ||
                user.email ||
                "U"
              )
                .charAt(0)
                .toUpperCase()
            )}

          </button>

          <input
            ref={profileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={changeProfilePhoto}
          />

          <div className="profile-info">

            <strong>
              {profile?.name ||
                user.displayName ||
                user.email?.split("@")[0]}
            </strong>

            <span>
              <i></i>
              {changingDp
                ? "Updating photo..."
                : "Online"}
            </span>

          </div>

        </div>

        {/* SEARCH */}

        <div className="search-box">

          <input
            type="email"
            placeholder="Search by email..."
            value={searchEmail}
            onChange={(e) =>
              setSearchEmail(
                e.target.value
              )
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                searchUser();
              }
            }}
          />

          <button
            onClick={searchUser}
          >
            🔎 Search User
          </button>

        </div>

        {/* SEARCH RESULT */}

        {searchResult && (
          <div
            className="chat-user"
            onClick={() =>
              openChat(searchResult)
            }
          >

            <div className="user-avatar">

              {searchResult.photoURL ? (
                <img
                  src={
                    searchResult.photoURL
                  }
                  alt=""
                />
              ) : (
                "👤"
              )}

            </div>

            <div className="chat-user-info">

              <strong>
                {searchResult.name}
              </strong>

              <span>
                {searchResult.email}
              </span>

            </div>

            {searchResult.online && (
              <div className="online-dot"></div>
            )}

          </div>
        )}

        <div className="side-title">
          CHATS
        </div>

        {/* ACTIVE CHAT */}

        {selectedUser && (
          <div
            className="chat-user active"
            onClick={() =>
              openChat(selectedUser)
            }
          >

            <div className="user-avatar">

              {selectedUser.photoURL ? (
                <img
                  src={
                    selectedUser.photoURL
                  }
                  alt=""
                />
              ) : (
                "👤"
              )}

            </div>

            <div className="chat-user-info">

              <strong>
                {selectedUser.name}
              </strong>

              <span>
                {selectedUser.online
                  ? "Online"
                  : "Offline"}
              </span>

            </div>

            {selectedUser.online && (
              <div className="online-dot"></div>
            )}

          </div>
        )}

        <div className="side-bottom">

          <button
            className="logout-btn"
            onClick={logout}
          >
            🚪 Logout
          </button>

        </div>

      </aside>

      {/* =================================================
          CHAT AREA
      ================================================= */}

      <main className="chat-area">

        {!selectedUser ? (

          <div className="empty-chat">

            <div>

              <div className="empty-icon">
                💬
              </div>

              <h1>
                Welcome to PawanKChat
              </h1>

              <p>
                Search a user by email and
                start a real-time conversation.
              </p>

              <div className="empty-features">

                <span>
                  💬 Messages
                </span>

                <span>
                  📷 Photos
                </span>

                <span>
                  📎 Files
                </span>

                <span>
                  📞 Calls
                </span>

              </div>

            </div>

          </div>

        ) : (

          <>

            {/* =================================================
                CHAT HEADER
            ================================================= */}

            <header className="chat-header">

              <div className="person">

                <div className="person-avatar">

                  {selectedUser.photoURL ? (
                    <img
                      src={
                        selectedUser.photoURL
                      }
                      alt=""
                    />
                  ) : (
                    "👤"
                  )}

                </div>

                <div>

                  <h3>
                    {selectedUser.name}
                  </h3>

                  <span>

                    <i></i>

                    {selectedUser.online
                      ? "Online now"
                      : "Offline"}

                  </span>

                </div>

              </div>

              <div className="call-buttons">

                <button
                  className="icon-button"
                  title="Audio Call"
                  disabled={
                    !!activeCall ||
                    !!incomingCall
                  }
                  onClick={() =>
                    startCall("audio")
                  }
                >
                  📞
                </button>

                <button
                  className="icon-button video-button"
                  title="Video Call"
                  disabled={
                    !!activeCall ||
                    !!incomingCall
                  }
                  onClick={() =>
                    startCall("video")
                  }
                >
                  🎥
                </button>

              </div>

            </header>

            {/* =================================================
                MESSAGES
            ================================================= */}

            <section className="messages">

              <div className="date-line">
                <span>
                  Private chat
                </span>
              </div>

              {messages.length === 0 && (
                <div className="welcome-box">

                  <div className="welcome-icon">
                    🔐
                  </div>

                  <h2>
                    Start a private chat
                  </h2>

                  <p>
                    Send your first message to{" "}
                    {selectedUser.name}.
                  </p>

                </div>
              )}

              {messages.map((msg) => (

                <div
                  key={msg.id}
                  className={`message-row ${
                    msg.senderId === user.uid
                      ? "mine"
                      : "theirs"
                  }`}
                >

                  {msg.senderId !== user.uid && (
                    <div className="small-avatar">

                      {selectedUser.photoURL ? (
                        <img
                          src={
                            selectedUser.photoURL
                          }
                          alt=""
                        />
                      ) : (
                        "👤"
                      )}

                    </div>
                  )}

                  <div className="message-bubble">

                    {/* IMAGE */}

                    {msg.type === "image" &&
                      msg.fileURL && (
                        <a
                          href={msg.fileURL}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <img
                            className="chat-image"
                            src={msg.fileURL}
                            alt={
                              msg.fileName ||
                              "Shared image"
                            }
                          />
                        </a>
                      )}

                    {/* FILE */}

                    {msg.type === "file" &&
                      msg.fileURL && (
                        <a
                          className="file-message"
                          href={msg.fileURL}
                          target="_blank"
                          rel="noopener noreferrer"
                          download
                        >
                          <span className="file-icon">
                            📎
                          </span>

                          <span className="file-info">

                            <strong>
                              {msg.fileName ||
                                "Shared file"}
                            </strong>

                            <small>
                              {formatFileSize(
                                msg.fileSize
                              )}
                            </small>

                          </span>

                          <span>
                            ⬇
                          </span>

                        </a>
                      )}

                    {/* TEXT */}

                    {msg.text && (
                      <p className="message-text">
                        {renderText(
                          msg.text
                        )}
                      </p>
                    )}

                    <small className="message-meta">

                      {msg.createdAt?.toDate
                        ? msg.createdAt
                            .toDate()
                            .toLocaleTimeString(
                              [],
                              {
                                hour: "2-digit",
                                minute:
                                  "2-digit",
                              }
                            )
                        : "Sending..."}

                      {msg.senderId ===
                        user.uid &&
                        " ✓"}

                    </small>

                  </div>

                </div>

              ))}

              {uploading && (
                <div className="uploading-message">
                  <div className="upload-spinner"></div>
                  <span>Uploading...</span>
                </div>
              )}

            </section>

            {/* =================================================
                MESSAGE COMPOSER
            ================================================= */}

            <footer className="composer">

              {/* Hidden image input */}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleImageSelect}
              />

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                hidden
                onChange={handleFileSelect}
              />

              {/* ATTACHMENT BUTTON */}

              <div className="attachment-wrapper">

                <button
                  type="button"
                  className="attach"
                  title="Attach"
                  onClick={() =>
                    setShowAttachmentMenu(
                      !showAttachmentMenu
                    )
                  }
                  disabled={uploading}
                >
                  📎
                </button>

                {/* ATTACHMENT MENU */}

                {showAttachmentMenu && (
                  <div className="attachment-menu">

                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachmentMenu(false);
                        imageInputRef.current?.click();
                      }}
                    >
                      <span>🖼️</span>
                      <div>
                        <strong>Photo</strong>
                        <small>
                          Share an image
                        </small>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachmentMenu(false);
                        fileInputRef.current?.click();
                      }}
                    >
                      <span>📄</span>
                      <div>
                        <strong>File</strong>
                        <small>
                          Share a document or file
                        </small>
                      </div>
                    </button>

                  </div>
                )}

              </div>

              {/* MESSAGE INPUT */}

              <input
                type="text"
                placeholder={
                  uploading
                    ? "Uploading..."
                    : "Type a message..."
                }
                value={message}
                disabled={uploading}
                onChange={(e) =>
                  setMessage(e.target.value)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />

              {/* SEND BUTTON */}

              <button
                className="send"
                type="button"
                onClick={sendMessage}
                disabled={
                  sending ||
                  uploading ||
                  !message.trim()
                }
                title="Send message"
              >
                {sending ? "..." : "➤"}
              </button>

            </footer>

          </>

        )}

      </main>

      {/* =====================================================
          INCOMING CALL
      ===================================================== */}

      {incomingCall && !activeCall && (
        <div className="incoming-call-overlay">

          <div className="incoming-call-card">

            <div className="incoming-avatar">

              {incomingCall.type === "video"
                ? "🎥"
                : "📞"}

            </div>

            <div className="incoming-label">
              INCOMING CALL
            </div>

            <h2>
              {incomingCall.callerName ||
                "PawanKChat User"}
            </h2>

            <p>
              {incomingCall.type === "video"
                ? "Video call"
                : "Audio call"}
            </p>

            <div className="incoming-actions">

              {/* DECLINE */}

              <button
                className="reject-call"
                type="button"
                onClick={rejectCall}
              >
                <span>✕</span>
                <span>Decline</span>
              </button>

              {/* ACCEPT */}

              <button
                className="accept-call"
                type="button"
                onClick={acceptCall}
              >
                <span>✓</span>
                <span>Accept</span>
              </button>

            </div>

          </div>

        </div>
      )}

      {/* =====================================================
          ACTIVE CALL WINDOW
      ===================================================== */}

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

      {/* =====================================================
          GLOBAL ERROR TOAST
      ===================================================== */}

      {error && (
        <div className="global-error">
          <span>⚠️</span>

          <span>{error}</span>

          <button
            type="button"
            onClick={() => setError("")}
          >
            ✕
          </button>
        </div>
      )}

    </div>
  );
}

export default App;