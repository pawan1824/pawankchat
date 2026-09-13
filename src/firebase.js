import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBJ3615w8ZtyOcCxEtY8Xh4azL-0OscOys",
  authDomain: "mychat-c1943.firebaseapp.com",
  projectId: "mychat-c1943",
  storageBucket: "mychat-c1943.firebasestorage.app",
  messagingSenderId: "224888977290",
  appId: "1:224888977290:web:169e5d7d85873203c1fa73",
  measurementId: "G-JR2QG6VH73"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);