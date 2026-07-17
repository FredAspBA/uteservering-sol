// Firebase-projektets webbkonfiguration. Dessa värden är identifierare
// (inte hemligheter) och är gjorda för att ligga öppet i klientkod —
// säkerheten sköts av Firestores säkerhetsregler (se firestore.rules).
//
// null = delad molnlagring avstängd; rösterna sparas då bara lokalt i
// webbläsaren precis som innan. Klistra in ditt firebaseConfig-objekt
// från Firebase Console (Project settings -> Your apps -> </>) här för
// att aktivera delad lagring.
export const firebaseConfig = {
  apiKey: "AIzaSyDQReEeVR9Vgg59p_YhUTSXz954Mo00R1g",
  authDomain: "uteservering-040-sol.firebaseapp.com",
  databaseURL: "https://uteservering-040-sol-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "uteservering-040-sol",
  storageBucket: "uteservering-040-sol.firebasestorage.app",
  messagingSenderId: "1095507523329",
  appId: "1:1095507523329:web:96542593f427daf2f8cd00",
};
