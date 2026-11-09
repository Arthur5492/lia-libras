import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from "firebase/auth";

// These values are public. The Firestore rules and the API protect the data.
const firebaseConfig = {
  apiKey: "AIzaSyCsCtgk_MJ3J-lseK-BcPWbh2SdAAnqkSE",
  authDomain: "friendlyeats-ef685.firebaseapp.com",
  projectId: "friendlyeats-ef685",
  storageBucket: "friendlyeats-ef685.firebasestorage.app",
  messagingSenderId: "862604928026",
  appId: "1:862604928026:web:dd859dbac3977e730f9da3",
};

const useEmulators = import.meta.env.VITE_EMULATORS === "1";

export const app = initializeApp(useEmulators ? { ...firebaseConfig, projectId: "demo-libras" } : firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
}
