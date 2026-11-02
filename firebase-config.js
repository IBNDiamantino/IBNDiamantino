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
// Imagens vão para o R2; no Firestore fica só o link.
// Token novo — nov/2026
// ==============================================
const R2_CONFIG = {
    accountId: '8564cf6532488ef0f60f172f6888c3b4',
    accessKeyId: '19a74986d7a36f940a2ef5a1e0e21dda',
    secretAccessKey: '9defd01209446e45b2dac54b7441add532e83baf3b5a19b21aa778b2e0b0e0c',
    bucket: 'ibn-diamantino-fotos',
    publicBase: 'https://pub-0f1d5e64aade4cd18ab9635ae2e515af.r2.dev',
    endpoint: 'https://8564cf6532488ef0f60f172f6888c3b4.r2.cloudflarestorage.com'
};
