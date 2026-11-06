// Importar módulos de Firebase v11
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

// Configuración de tu proyecto en Firebase Console
const firebaseConfig = {
    apiKey: "AIzaSyBuALpL3yASG71IY5wPkKi4gPtkIC4S_2w",
    authDomain: "citafacil-7d175.firebaseapp.com",
    projectId: "citafacil-7d175",
    storageBucket: "citafacil-7d175.firebasestorage.app",
    messagingSenderId: "247800903091",
    appId: "1:247800903091:web:71367551f04a511bc947c6"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
