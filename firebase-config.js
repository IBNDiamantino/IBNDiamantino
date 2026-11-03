// ==============================================
// CONFIGURAÇÃO DA NUVEM (Firebase / Firestore)
// Projeto: ibn-diamantino-31e1a
// ==============================================

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDBPFiPtkeGonzNFiZ6qTXXLjb-XOsnibY",
    authDomain: "ibn-diamantino-31e1a.firebaseapp.com",
    projectId: "ibn-diamantino-31e1a",
    storageBucket: "ibn-diamantino-31e1a.firebasestorage.app",
    messagingSenderId: "437326472097",
    appId: "1:437326472097:web:16d235adebf3641497e1e0",
    measurementId: "G-FXWCC725FG"
};

// true = usa a nuvem | false = só localStorage no aparelho
const NUVEM_ATIVA = true;

// ==============================================
// Cloudflare R2 — fotos (ministérios e células)
// Bucket: ibn-diamantino-fotos
// Token S3 novo — nov/2026 (validado)
// ==============================================
const R2_CONFIG = {
    accountId: '8564cf6532488ef0f60f172f6888c3b4',
    accessKeyId: 'b0873f9ec8542ea523b811f8b3d9c869',
    secretAccessKey: '9c09d5e0ef0c61f22c6d0ca030d1e0e48d9131826d0ed5f913470a3ba2cf283e',
    bucket: 'ibn-diamantino-fotos',
    publicBase: 'https://pub-0f1d5e64aade4cd18ab9635ae2e515af.r2.dev',
    endpoint: 'https://8564cf6532488ef0f60f172f6888c3b4.r2.cloudflarestorage.com'
};
