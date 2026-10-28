// ==============================================
// SINCRONIZAÇÃO COM A NUVEM — IBN Diamantino
// Não substitui o funcionamento local: grava no
// aparelho E, se a nuvem estiver configurada,
// envia cópia para o Firebase (admin/gestor baixa CSV).
// ==============================================

const IBNNuvem = (function () {
    let db = null;
    let pronto = false;
    let ultimoErro = null;

    function configValida() {
        if (typeof FIREBASE_CONFIG === 'undefined' || typeof NUVEM_ATIVA === 'undefined') return false;
        if (!NUVEM_ATIVA) return false;
        const c = FIREBASE_CONFIG;
        if (!c || !c.apiKey || !c.projectId) return false;
        if (String(c.apiKey).indexOf('COLE_AQUI') !== -1) return false;
        if (String(c.projectId).indexOf('COLE_AQUI') !== -1) return false;
        return true;
    }

    function iniciar() {
        if (pronto) return true;
        if (!configValida()) {
            ultimoErro = 'Nuvem não configurada (firebase-config.js). Site segue só no aparelho.';
            return false;
        }
        if (typeof firebase === 'undefined') {
            ultimoErro = 'Biblioteca Firebase não carregou.';
            return false;
        }
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(FIREBASE_CONFIG);
            }
            db = firebase.firestore();
            pronto = true;
            ultimoErro = null;
            return true;
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            pronto = false;
            return false;
        }
    }

    function status() {
        return {
            configurada: configValida(),
            conectada: pronto,
            erro: ultimoErro
        };
    }


    // ---------- Cloudflare R2 (fotos) ----------
    function r2Ativo() {
        return typeof R2_CONFIG !== 'undefined' && R2_CONFIG && R2_CONFIG.accessKeyId && R2_CONFIG.secretAccessKey && R2_CONFIG.bucket && R2_CONFIG.publicBase;
    }

    function _r2ToHex(buf) {
        return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }

    async function _r2Hmac(key, data) {
        var enc = new TextEncoder();
        var cryptoKey = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        return crypto.subtle.sign('HMAC', cryptoKey, typeof data === 'string' ? enc.encode(data) : data);
    }

    async function _r2Sha256(data) {
        var enc = new TextEncoder();
        var buf = typeof data === 'string' ? enc.encode(data) : data;
        return crypto.subtle.digest('SHA-256', buf);
    }

    async function _r2GetSignatureKey(secret, dateStamp, region, service) {
        var kDate = await _r2Hmac('AWS4' + secret, dateStamp);
        var kRegion = await _r2Hmac(kDate, region);
        var kService = await _r2Hmac(kRegion, service);
        return _r2Hmac(kService, 'aws4_request');
    }

    /** Converte data:URL em Blob */
    function dataUrlParaBlob(dataUrl) {
        var parts = String(dataUrl).split(',');
        var meta = parts[0] || '';
        var b64 = parts[1] || '';
        var mime = 'image/jpeg';
        var m = meta.match(/data:([^;]+)/);
        if (m) mime = m[1];
        var bin = atob(b64);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: mime });
    }

    /**
     * Sobe arquivo/blob para o R2 e devolve a URL publica.
     * key exemplo: ministerios/foto-123.jpg ou celulas/fc-456.jpg
     */
    async function uploadParaR2(blob, key, contentType) {
        if (!r2Ativo()) throw new Error('R2 nao configurado (R2_CONFIG em firebase-config.js)');
        if (!blob) throw new Error('Sem arquivo para enviar ao R2');
        contentType = contentType || blob.type || 'image/jpeg';
        key = String(key || '').replace(/^\/+/, '');
        if (!key) throw new Error('Chave R2 vazia');

        var cfg = R2_CONFIG;
        var method = 'PUT';
        var service = 's3';
        var region = 'auto';
        var host = cfg.accountId + '.r2.cloudflarestorage.com';
        var canonicalUri = '/' + cfg.bucket + '/' + key.split('/').map(encodeURIComponent).join('/');
        var now = new Date();
        var amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
        // YYYYMMDDTHHMMSSZ
        amzDate = now.getUTCFullYear().toString() +
            String(now.getUTCMonth() + 1).padStart(2, '0') +
            String(now.getUTCDate()).padStart(2, '0') + 'T' +
            String(now.getUTCHours()).padStart(2, '0') +
            String(now.getUTCMinutes()).padStart(2, '0') +
            String(now.getUTCSeconds()).padStart(2, '0') + 'Z';
        var dateStamp = amzDate.slice(0, 8);

        var payloadHash = _r2ToHex(await _r2Sha256(await blob.arrayBuffer()));
        var canonicalHeaders =
            'content-type:' + contentType + '\n' +
            'host:' + host + '\n' +
            'x-amz-content-sha256:' + payloadHash + '\n' +
            'x-amz-date:' + amzDate + '\n';
        var signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
        var canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
        var credentialScope = dateStamp + '/' + region + '/' + service + '/aws4_request';
        var stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, _r2ToHex(await _r2Sha256(canonicalRequest))].join('\n');
        var signingKey = await _r2GetSignatureKey(cfg.secretAccessKey, dateStamp, region, service);
        var signature = _r2ToHex(await _r2Hmac(signingKey, stringToSign));
        var authorization = 'AWS4-HMAC-SHA256 Credential=' + cfg.accessKeyId + '/' + credentialScope +
            ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

        var url = 'https://' + host + canonicalUri;
        var resp = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': contentType,
                'x-amz-content-sha256': payloadHash,
                'x-amz-date': amzDate,
                'Authorization': authorization
            },
            body: blob
        });
        if (!resp.ok) {
            var txt = '';
            try { txt = await resp.text(); } catch (e) {}
            throw new Error('Falha R2 (' + resp.status + '): ' + (txt || resp.statusText).slice(0, 200));
        }
        var publicUrl = String(cfg.publicBase).replace(/\/$/, '') + '/' + key;
        return publicUrl;
    }


    // ---- Controle de último envio de membros (detecta cadastros presos no aparelho) ----
    var CHAVE_ULTIMO_ENVIO_MEMBROS = 'ibn_nuvem_ultimo_envio_membros';
    var CHAVE_ULTIMO_ENVIO_FORCE = 'ibn_nuvem_ultimo_force_membros';
    var MS_24H = 24 * 60 * 60 * 1000;
    var _forceEnvioBusy = false;

    function registrarEnvioMembrosOk(extra) {
        try {
            var info = {
                em: new Date().toISOString(),
                quantidade: (extra && extra.quantidade) || 0,
                force: !!(extra && extra.force)
            };
            localStorage.setItem(CHAVE_ULTIMO_ENVIO_MEMBROS, JSON.stringify(info));
            if (info.force) {
                localStorage.setItem(CHAVE_ULTIMO_ENVIO_FORCE, info.em);
            }
        } catch (e) {}
    }

    function lerUltimoEnvioMembros() {
        try {
            var raw = localStorage.getItem(CHAVE_ULTIMO_ENVIO_MEMBROS);
            if (!raw) return null;
            var o = JSON.parse(raw);
            if (!o || !o.em) return null;
            return o;
        } catch (e) { return null; }
    }

    function msDesdeUltimoEnvioMembros() {
        var u = lerUltimoEnvioMembros();
        if (!u || !u.em) return Infinity;
        var t = Date.parse(u.em);
        if (!t) return Infinity;
        return Math.max(0, Date.now() - t);
    }

    function precisaForceEnvio24h() {
        return msDesdeUltimoEnvioMembros() >= MS_24H;
    }

    /** Envia TODOS os membros do aparelho com force=true (recupera cadastros que não subiram). */
    async function forcarEnvioMembrosLocais(onProgress) {
        if (_forceEnvioBusy) return { sucesso: false, ocupado: true, mensagem: 'Já há um envio em andamento' };
        if (!iniciar() || !db) return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponível' };
        _forceEnvioBusy = true;
        try {
            var membros = (typeof lerMembros === 'function') ? lerMembros() : [];
            // Garante atualizadoEm em quem ainda não tem (cadastros antigos presos)
            try {
                membros.forEach(function (m) {
                    if (!m) return;
                    if (!m.atualizadoEm && !m.criadoEm) {
                        m.atualizadoEm = m.dataCadastro || new Date().toISOString();
                        if (!m.criadoEm && m.dataCadastro) m.criadoEm = m.dataCadastro;
                    }
                });
                if (typeof salvarMembros === 'function') {
                    // grava só storage sem cascade: setItem direto se possível
                    try {
                        localStorage.setItem(
                            (typeof CHAVE_MEMBROS !== 'undefined' ? CHAVE_MEMBROS : 'ibn_membros'),
                            JSON.stringify(membros.filter(function (m) {
                                if (!m) return false;
                                try { if (typeof isContaSistema === 'function' && isContaSistema(m)) return false; } catch (e) {}
                                return true;
                            }))
                        );
                    } catch (eS) {}
                }
            } catch (ePrep) {}

            var r = await sincronizarMembros(membros, {
                force: true,
                onProgress: onProgress || null
            });
            if (r && r.sucesso) {
                registrarEnvioMembrosOk({ quantidade: r.quantidade || membros.length, force: true });
            }
            return {
                sucesso: !!(r && r.sucesso),
                quantidade: (r && r.quantidade) || 0,
                erros: (r && r.erros) || 0,
                totalLocal: membros.length,
                mensagem: r && r.sucesso
                    ? ('Forçado: ' + ((r && r.quantidade) || 0) + ' membro(s) enviados de ' + membros.length + ' no aparelho')
                    : ((r && r.mensagem) || ultimoErro || 'Falha no envio forçado')
            };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, mensagem: ultimoErro };
        } finally {
            _forceEnvioBusy = false;
        }
    }

    /**
     * Sobe só os cadastros que existem NESTE aparelho e ainda NÃO estão na nuvem.
     * Use no celular onde a pessoa se cadastrou (é lá que o localStorage tem o registro).
     */
    async function enviarCadastrosAusentesNaNuvem(onProgress) {
        if (!iniciar() || !db) {
            return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponível. Confira as Regras do Firestore.' };
        }
        try {
            var locais = (typeof lerMembros === 'function') ? (lerMembros() || []) : [];
            locais = locais.filter(function (m) {
                if (!m || m.id === undefined || m.id === null || m.id === '') return false;
                try { if (typeof isContaSistema === 'function' && isContaSistema(m)) return false; } catch (e) {}
                try { if (typeof membroFoiExcluido === 'function' && membroFoiExcluido(m)) return false; } catch (e2) {}
                return true;
            });

            if (typeof onProgress === 'function') {
                try { onProgress(0, locais.length, 'comparando'); } catch (eP0) {}
            }

            // IDs já na nuvem
            var naNuvem = {};
            try {
                var snap = await _comTimeout(db.collection('membros').get(), 15000, 'timeout_list');
                if (snap && snap.__timeout) {
                    return {
                        sucesso: false,
                        mensagem: 'Timeout ao listar membros da nuvem. Publique as Regras do Firestore e tente de novo.'
                    };
                }
                snap.forEach(function (doc) {
                    naNuvem[String(doc.id)] = true;
                });
            } catch (eList) {
                var ml = (eList && (eList.code || eList.message)) || String(eList);
                if (String(ml).indexOf('permission') !== -1) {
                    return {
                        sucesso: false,
                        mensagem: 'Firestore bloqueou a leitura (regras). Publique firestore.rules no Firebase Console.'
                    };
                }
                return { sucesso: false, mensagem: 'Não listou a nuvem: ' + ml };
            }

            var faltando = locais.filter(function (m) {
                return !naNuvem[String(m.id)];
            });

            if (!faltando.length) {
                registrarEnvioMembrosOk({ quantidade: 0, force: true });
                return {
                    sucesso: true,
                    quantidade: 0,
                    totalLocal: locais.length,
                    totalNuvem: Object.keys(naNuvem).length,
                    mensagem: 'Nenhum cadastro faltando: os ' + locais.length + ' deste aparelho já estão na nuvem (nuvem tem ' + Object.keys(naNuvem).length + ').'
                };
            }

            // Garante timestamps
            faltando.forEach(function (m) {
                if (!m.atualizadoEm) m.atualizadoEm = m.dataCadastro || new Date().toISOString();
                if (!m.criadoEm) m.criadoEm = m.dataCadastro || m.atualizadoEm;
            });

            var enviados = 0;
            var erros = 0;
            var detalhesErros = [];
            for (var i = 0; i < faltando.length; i++) {
                if (typeof onProgress === 'function') {
                    try { onProgress(i + 1, faltando.length, 'enviando'); } catch (eP) {}
                }
                try {
                    var r1 = await sincronizarUmMembro(faltando[i], { force: true });
                    if (r1 && r1.sucesso) {
                        enviados++;
                        if (typeof marcarPendenteNuvem === 'function') {
                            try { marcarPendenteNuvem(faltando[i].id, false); } catch (eM) {}
                        }
                    } else {
                        erros++;
                        if (detalhesErros.length < 3) {
                            detalhesErros.push((faltando[i].nome || faltando[i].id) + ': ' + ((r1 && r1.mensagem) || 'falha'));
                        }
                    }
                } catch (eItem) {
                    erros++;
                    if (detalhesErros.length < 3) {
                        detalhesErros.push((faltando[i].nome || '') + ': ' + ((eItem && eItem.message) || String(eItem)));
                    }
                }
            }

            if (enviados > 0) {
                registrarEnvioMembrosOk({ quantidade: enviados, force: true });
            }

            var msg = 'Faltavam ' + faltando.length + ' neste aparelho. Enviados: ' + enviados;
            if (erros) msg += ' · Falhas: ' + erros + (detalhesErros.length ? ' (' + detalhesErros.join(' | ') + ')' : '');
            if (erros && /permission|timeout|Regras|regras/i.test(msg)) {
                msg += ' → Publique as Regras do Firestore no Firebase.';
            }

            return {
                sucesso: enviados > 0 || erros === 0,
                quantidade: enviados,
                faltavam: faltando.length,
                erros: erros,
                totalLocal: locais.length,
                totalNuvem: Object.keys(naNuvem).length,
                mensagem: msg,
                nomes: faltando.slice(0, 15).map(function (m) { return m.nome || String(m.id); })
            };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }

    /** Se passou 24h sem envio bem-sucedido, força upload silencioso dos membros locais. */
    async function verificarEForcarEnvioSe24h(motivo) {
        if (!configValida()) return { sucesso: false, pulou: true, motivo: 'nuvem_inativa' };
        if (!precisaForceEnvio24h()) {
            return { sucesso: true, pulou: true, motivo: 'ainda_no_prazo', ms: msDesdeUltimoEnvioMembros() };
        }
        // Evita vários aparelhos/abas martelando ao mesmo tempo: no máximo 1 force auto a cada 2h
        try {
            var lastForce = localStorage.getItem(CHAVE_ULTIMO_ENVIO_FORCE);
            if (lastForce) {
                var tF = Date.parse(lastForce);
                if (tF && (Date.now() - tF) < (2 * 60 * 60 * 1000)) {
                    return { sucesso: true, pulou: true, motivo: 'force_recente' };
                }
            }
        } catch (eF) {}
        console.info('IBNNuvem: >24h sem envio de membros — enviando ausentes (' + (motivo || '') + ')');
        try {
            var ra = await enviarCadastrosAusentesNaNuvem(null);
            if (ra && (ra.quantidade > 0 || ra.sucesso)) return ra;
        } catch (eA) {}
        return await forcarEnvioMembrosLocais(null);
    }

    // Envia dados do membro para a nuvem (inclui senha para login em vários aparelhos).
    // Resposta de segurança continua só no aparelho por privacidade extra.
    function membroPublico(m) {
        if (!m) return null;
        try {
            if (typeof isContaSistema === 'function' && isContaSistema(m)) return null;
        } catch (e) {}
        const copia = Object.assign({}, m);
        delete copia.respostaSeguranca;
        // Nunca manda foto/base64 no doc do membro (Firestore trava / estoura limite)
        delete copia.foto;
        delete copia.fotoUrl;
        delete copia.avatar;
        delete copia.imagem;
        delete copia.imagemUrl;
        delete copia.dataUrl;
        delete copia.base64;
        delete copia.fotos;
        // Remove campos acidentalmente enormes
        Object.keys(copia).forEach(function (k) {
            try {
                var v = copia[k];
                if (typeof v === 'string' && v.length > 20000) delete copia[k];
                if (typeof v === 'string' && v.indexOf('data:image') === 0) delete copia[k];
            } catch (eK) {}
        });
        return copia;
    }

    function _tsMembro(m) {
        return Date.parse((m && (m.atualizadoEm || m.criadoEm || m.dataCadastro)) || '') || 0;
    }

    /** Só grava se a versão local for igual ou mais nova que a da nuvem (evita PC antigo apagar celular).
     * force=true: gestão/aprovação sempre grava (não deixa cópia antiga bloquear). */
    function _comTimeout(promessa, ms, motivo) {
        return Promise.race([
            promessa,
            new Promise(function (resolve) {
                setTimeout(function () {
                    resolve({ __timeout: true, motivo: motivo || ('timeout_' + ms + 'ms') });
                }, ms);
            })
        ]);
    }

    async function _gravarMembroSeMaisNovo(col, m, force) {
        var pub = membroPublico(m);
        if (!pub) return { ok: false, motivo: 'invalido' };
        var ref = col.doc(String(m.id));
        var tLocal = _tsMembro(m);
        if (!force) {
            try {
                var snapGet = await _comTimeout(ref.get(), 5000, 'timeout_get');
                if (snapGet && snapGet.__timeout) {
                    // get demorou: grava mesmo assim
                } else if (snapGet && snapGet.exists) {
                    var remote = snapGet.data() || {};
                    var tRemote = _tsMembro(remote);
                    if (tRemote > tLocal) {
                        return { ok: false, motivo: 'nuvem_mais_nova', remoto: remote };
                    }
                }
            } catch (eGet) {
                var msgG = (eGet && (eGet.code || eGet.message)) || '';
                if (String(msgG).indexOf('permission') !== -1) {
                    return { ok: false, motivo: 'permission-denied', detalhe: String(msgG) };
                }
            }
        }
        if (!pub.atualizadoEm || force) pub.atualizadoEm = new Date().toISOString();
        try {
            // set com timeout; se rules bloqueiam, costuma vir permission-denied rápido
            var setPromise = ref.set(pub, { merge: true }).then(function () {
                return { ok: true };
            }).catch(function (eSet) {
                var code = String((eSet && eSet.code) || '');
                var msg = (eSet && eSet.message) || String(eSet);
                var blob = (code + ' ' + msg).toLowerCase();
                if (blob.indexOf('permission') !== -1) {
                    return { ok: false, motivo: 'permission-denied', detalhe: msg };
                }
                // Cota Spark esgotada
                if (blob.indexOf('resource-exhausted') !== -1 || blob.indexOf('quota') !== -1 ||
                    blob.indexOf('429') !== -1 || blob.indexOf('exceeded') !== -1) {
                    return { ok: false, motivo: 'quota_exceeded', detalhe: msg };
                }
                return { ok: false, motivo: 'erro_firebase', detalhe: msg };
            });
            var setRes = await _comTimeout(setPromise, 10000, 'timeout_set');
            if (setRes && setRes.__timeout) {
                // Timeout longo no Spark costuma ser cota/rede — mensagem orienta tentar outro dia
                return {
                    ok: false,
                    motivo: 'timeout_set',
                    possivelQuota: true,
                    detalhe: 'Firebase não respondeu a tempo (rede ou cota diária esgotada).'
                };
            }
            return setRes;
        } catch (e) {
            return { ok: false, motivo: 'erro_firebase', detalhe: (e && e.message) || String(e) };
        }
    }

    async function sincronizarMembros(lista, opcoes) {
        if (!iniciar() || !db) return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponível' };
        var force = !!(opcoes && opcoes.force);
        var onProgress = (opcoes && opcoes.onProgress) || null;
        try {
            const col = db.collection('membros');
            const itens = (lista || []).filter(function (m) {
                if (!m || m.id === undefined || m.id === null || m.id === '') return false;
                try { if (typeof isContaSistema === 'function' && isContaSistema(m)) return false; } catch (e) {}
                if (typeof membroFoiExcluido === 'function' && membroFoiExcluido(m)) return false;
                return true;
            });
            let enviados = 0;
            let ignorados = 0;
            let erros = 0;

            // Envio em lote (rápido). force=true: grava sem ler um a um (evita "Enviando..." eterno)
            if (force) {
                var TAM = 20;
                for (var i = 0; i < itens.length; i += TAM) {
                    var fatia = itens.slice(i, i + TAM);
                    var batch = db.batch();
                    fatia.forEach(function (m) {
                        var pub = membroPublico(m);
                        if (!pub) return;
                        pub.atualizadoEm = pub.atualizadoEm || new Date().toISOString();
                        batch.set(col.doc(String(m.id)), pub, { merge: true });
                        enviados++;
                    });
                    try {
                        await batch.commit();
                    } catch (eBatch) {
                        console.warn('batch membros', eBatch);
                        // fallback um a um nesta fatia
                        for (var j = 0; j < fatia.length; j++) {
                            try {
                                var r1 = await _gravarMembroSeMaisNovo(col, fatia[j], true);
                                if (!r1.ok) erros++;
                            } catch (e1) { erros++; }
                        }
                    }
                    if (onProgress) {
                        try { onProgress(Math.min(i + TAM, itens.length), itens.length, 'membros'); } catch (eP) {}
                    }
                }
                if (enviados > 0 || force) registrarEnvioMembrosOk({ quantidade: enviados, force: true });
                return { sucesso: true, quantidade: enviados, ignorados: 0, erros: erros };
            }

            // Modo seguro (compara data) — usado em sync silenciosa
            for (let k = 0; k < itens.length; k++) {
                try {
                    var r = await _gravarMembroSeMaisNovo(col, itens[k], false);
                    if (r.ok) enviados++;
                    else ignorados++;
                } catch (eItem) {
                    erros++;
                    console.warn('sync membro', itens[k] && itens[k].id, eItem);
                }
                if (onProgress && k % 5 === 0) {
                    try { onProgress(k + 1, itens.length, 'membros'); } catch (eP2) {}
                }
            }
            if (enviados > 0) registrarEnvioMembrosOk({ quantidade: enviados, force: false });
            return { sucesso: true, quantidade: enviados, ignorados: ignorados, erros: erros };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            console.warn('IBNNuvem.sincronizarMembros:', ultimoErro);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }

    async function sincronizarUmMembro(m, opcoes) {
        if (!m) return { sucesso: false, mensagem: 'Membro vazio' };
        if (m.id === undefined || m.id === null || m.id === '') {
            m.id = Date.now();
        }
        if (!iniciar() || !db) return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponível' };
        var force = !!(opcoes && opcoes.force);
        try {
            if (typeof isContaSistema === 'function' && isContaSistema(m)) {
                return { sucesso: false, mensagem: 'Conta de sistema não vai para a lista de membros' };
            }
            if (typeof membroFoiExcluido === 'function' && membroFoiExcluido(m)) {
                return { sucesso: false, mensagem: 'Membro na lista de excluídos' };
            }
            if (typeof marcarMembroAtualizado === 'function') {
                try { marcarMembroAtualizado(m); } catch (eM) {}
            } else {
                m.atualizadoEm = new Date().toISOString();
            }
            var col = db.collection('membros');
            var r = await _gravarMembroSeMaisNovo(col, m, force);
            if (!r.ok && r.motivo === 'nuvem_mais_nova') {
                return { sucesso: true, ignorado: true, mensagem: 'Nuvem já tinha versão mais recente deste membro' };
            }
            if (!r.ok) {
                var msgF = r.motivo || 'Falha ao gravar';
                if (r.motivo === 'permission-denied') {
                    msgF = 'Firestore bloqueou a gravação (regras de segurança).';
                } else if (r.motivo === 'quota_exceeded') {
                    msgF = 'A nuvem da igreja atingiu o limite diário grátis. Tente de novo amanhã de manhã (depois das 4h–5h) ou avise a secretaria.';
                } else if (r.motivo === 'timeout_set' || r.motivo === 'timeout_12s') {
                    msgF = 'Não deu para enviar agora (rede lenta ou limite diário da nuvem). Tente de novo mais tarde ou amanhã de manhã.';
                }
                return { sucesso: false, mensagem: msgF, motivo: r.motivo, possivelQuota: !!(r.motivo === 'quota_exceeded' || r.possivelQuota) };
            }
            // Regrava no localStorage o membro já com atualizadoEm (evita cópia local “sem data”)
            try {
                if (typeof lerMembros === 'function' && typeof salvarMembros === 'function' && m && m.id !== undefined) {
                    var listaLoc = lerMembros();
                    var ixLoc = listaLoc.findIndex(function (x) { return String(x.id) === String(m.id); });
                    if (ixLoc >= 0) {
                        listaLoc[ixLoc].atualizadoEm = m.atualizadoEm || listaLoc[ixLoc].atualizadoEm;
                        if (m.atualizadoPorId) listaLoc[ixLoc].atualizadoPorId = m.atualizadoPorId;
                        if (m.atualizadoPorNome) listaLoc[ixLoc].atualizadoPorNome = m.atualizadoPorNome;
                        // Grava só no storage, sem re-disparar sync em cascata
                        localStorage.setItem(
                            (typeof CHAVE_MEMBROS !== 'undefined' ? CHAVE_MEMBROS : 'ibn_membros'),
                            JSON.stringify(listaLoc)
                        );
                    }
                }
            } catch (eLoc) {}
            registrarEnvioMembrosOk({ quantidade: 1, force: force });
            return { sucesso: true };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            console.warn('IBNNuvem.sincronizarUmMembro:', ultimoErro);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }


    async function puxarExcluidosParaLocal() {
        if (!iniciar() || !db) return { sucesso: false };
        try {
            const snap = await db.collection('config').doc('membros_excluidos').get();
            if (!snap.exists) return { sucesso: true, lista: [] };
            const data = snap.data() || {};
            const listaNuvem = Array.isArray(data.lista) ? data.lista : [];
            let local = [];
            try { local = JSON.parse(localStorage.getItem('ibn_membros_excluidos') || '[]'); } catch (e) { local = []; }
            const porId = {};
            local.concat(listaNuvem).forEach(function (x) {
                if (!x) return;
                const k = String(x.id || x.chave || x.email || '');
                if (k) porId[k] = Object.assign({}, porId[k] || {}, x);
            });
            const mesclada = Object.keys(porId).map(function (k) { return porId[k]; });
            localStorage.setItem('ibn_membros_excluidos', JSON.stringify(mesclada));
            return { sucesso: true, lista: mesclada };
        } catch (e) {
            return { sucesso: false, mensagem: (e && e.message) || String(e) };
        }
    }

    async function sincronizarExcluidos(lista) {
        if (!iniciar() || !db) return { sucesso: false };
        try {
            await db.collection('config').doc('membros_excluidos').set({
                lista: lista || [],
                atualizadoEm: new Date().toISOString()
            }, { merge: true });
            return { sucesso: true };
        } catch (e) {
            return { sucesso: false, mensagem: (e && e.message) || String(e) };
        }
    }

    async function puxarMembrosParaLocal() {
        const r = await buscarMembros();
        if (!r.sucesso) return r;
        try {
            // Carrega lista de removidos ANTES de mesclar (não ressuscita)
            try { await puxarExcluidosParaLocal(); } catch (e) {}
            function ehSistema(m) {
                try { return typeof isContaSistema === 'function' && isContaSistema(m); } catch (e) { return false; }
            }
            function foiExcl(m) {
                try { return typeof membroFoiExcluido === 'function' && membroFoiExcluido(m); } catch (e) { return false; }
            }
            function ts(m) {
                // Alinhado a _tsMembro: inclui dataCadastro (cadastros novos sem atualizadoEm)
                var t = Date.parse((m && (m.atualizadoEm || m.criadoEm || m.dataCadastro)) || '') || 0;
                return t;
            }
            const local = (typeof lerMembros === 'function') ? lerMembros() : [];
            const porId = {};
            local.forEach(function (m) {
                if (!m || m.id === undefined) return;
                if (ehSistema(m) || foiExcl(m)) return;
                porId[String(m.id)] = m;
            });
            /** Nunca rebaixa "aprovado" para "em_analise" — era o bug que desfazia a aprovação da Luana */
            function rankStatusMin(st) {
                st = String(st || '').toLowerCase();
                if (st === 'aprovado' || st === 'ok') return 3;
                if (st === 'em_analise' || st === 'pendente') return 2;
                if (st) return 1;
                return 0;
            }
            function mesclarStatusMinisterios(a, b) {
                var out = {};
                var keys = {};
                Object.keys(a || {}).forEach(function (k) { keys[k] = true; });
                Object.keys(b || {}).forEach(function (k) { keys[k] = true; });
                Object.keys(keys).forEach(function (k) {
                    var sa = (a && (a[k] || a[k.toLowerCase()])) || '';
                    var sb = (b && (b[k] || b[k.toLowerCase()])) || '';
                    out[k] = rankStatusMin(sa) >= rankStatusMin(sb) ? (sa || sb) : (sb || sa);
                });
                return out;
            }
            function unirMinisterios(listaA, listaB) {
                var out = [];
                function add(arr) {
                    (Array.isArray(arr) ? arr : []).forEach(function (n) {
                        var nome = String(n || '').trim();
                        if (!nome) return;
                        if (!out.some(function (x) { return String(x).toLowerCase() === nome.toLowerCase(); })) {
                            out.push(nome);
                        }
                    });
                }
                add(listaA);
                add(listaB);
                return out;
            }

            (r.lista || []).forEach(function (m) {
                if (!m || m.id === undefined) return;
                if (ehSistema(m) || foiExcl(m)) return;
                const id = String(m.id);
                if (!porId[id]) {
                    porId[id] = m;
                    return;
                }
                // Mantém o registro mais recente; não deixa a nuvem antiga apagar alteração do gestor
                const loc = porId[id];
                const senhaLocal = loc.senha;
                const respLocal = loc.respostaSeguranca;
                // Nuvem (m) prevalece se for mais nova OU empatada; local só se for claramente mais recente
                var base, other;
                if (ts(loc) > ts(m)) {
                    base = Object.assign({}, m, loc);
                    other = m;
                } else {
                    base = Object.assign({}, loc, m);
                    other = loc;
                }
                // Status de ministério: aprovado da gestão NUNCA perde para em_analise local
                base.ministeriosStatus = mesclarStatusMinisterios(
                    (loc && loc.ministeriosStatus) || {},
                    (m && m.ministeriosStatus) || {}
                );
                // Lista oficial: se nuvem >= local, usa lista da nuvem; senão união
                if (ts(m) >= ts(loc) && Array.isArray(m.ministerios)) {
                    base.ministerios = (m.ministerios || []).map(function (x) { return String(x).trim(); }).filter(Boolean);
                    (Array.isArray(loc.ministerios) ? loc.ministerios : []).forEach(function (n) {
                        var nome = String(n || '').trim();
                        if (!nome) return;
                        var stB = (base.ministeriosStatus || {})[nome] || '';
                        if (rankStatusMin(stB) >= 3) {
                            if (!base.ministerios.some(function (x) { return String(x).toLowerCase() === nome.toLowerCase(); })) {
                                base.ministerios.push(nome);
                            }
                        }
                    });
                } else {
                    base.ministerios = unirMinisterios(loc.ministerios, m.ministerios);
                }
                // Se o lado mais novo já limpou pendências de gestão, respeita
                if (ts(m) >= ts(loc) && m.alteracoesPendentesGestao === null) {
                    base.alteracoesPendentesGestao = null;
                } else if (ts(loc) > ts(m) && loc.alteracoesPendentesGestao === null) {
                    base.alteracoesPendentesGestao = null;
                }
                porId[id] = base;
                if (!porId[id].senha && senhaLocal) porId[id].senha = senhaLocal;
                if (!porId[id].respostaSeguranca && respLocal) porId[id].respostaSeguranca = respLocal;
                // Nunca rebaixar admin/gestor por causa de cópia antiga no outro aparelho
                (function preservarNivelGestao(a, b, dest) {
                    var rank = function (n) {
                        n = String(n || '').toLowerCase();
                        if (n === 'gestor') return 3;
                        if (n === 'admin') return 2;
                        return 1;
                    };
                    var best = rank(a && a.nivel) >= rank(b && b.nivel) ? (a && a.nivel) : (b && b.nivel);
                    if (rank(best) >= 2) {
                        dest.nivel = best;
                        if (best === 'admin' && (!dest.cargo || /membro/i.test(String(dest.cargo)))) {
                            dest.cargo = dest.cargo && !/membro/i.test(String(dest.cargo)) ? dest.cargo : 'Secretaria / Admin';
                        }
                        if (best === 'gestor' && (!dest.cargo || /membro/i.test(String(dest.cargo)))) {
                            dest.cargo = dest.cargo && !/membro/i.test(String(dest.cargo)) ? dest.cargo : 'Pastor / Gestor';
                        }
                    }
                })(loc, m, porId[id]);
            });
            let mesclada = Object.keys(porId).map(function (k) { return porId[k]; });
            mesclada = mesclada.filter(function (m) { return !ehSistema(m) && !foiExcl(m); });
            localStorage.setItem('ibn_membros', JSON.stringify(mesclada));
            if (typeof deduplicarMembrosLocais === 'function') {
                mesclada = deduplicarMembrosLocais();
            }
            // Atualiza sessão logada (cargos/lideranças/ministérios vindos da nuvem)
            try {
                if (typeof atualizarSessaoDoCadastro === 'function') atualizarSessaoDoCadastro();
            } catch (eSess) {}
            try {
                // Reforço: se o usuário logado está na lista mesclada, atualiza sessão com dados novos
                var u = (typeof getUsuarioLogado === 'function') ? getUsuarioLogado() : null;
                if (u && u.id !== undefined) {
                    var naLista = mesclada.find(function (x) { return String(x.id) === String(u.id); });
                    if (naLista && typeof iniciarSessao === 'function') {
                        // mantém senha da sessão se a mescla não trouxe
                        if (!naLista.senha && u.senha) naLista.senha = u.senha;
                        iniciarSessao(naLista);
                    }
                }
            } catch (eSess2) {}
            return { sucesso: true, lista: mesclada };
        } catch (e) {
            return { sucesso: false, mensagem: String(e) };
        }
    }

    async function buscarMembros() {
        if (!iniciar() || !db) return { sucesso: false, lista: [], mensagem: ultimoErro };
        try {
            const snap = await db.collection('membros').get();
            const lista = [];
            snap.forEach(function (doc) {
                lista.push(Object.assign({ id: doc.id }, doc.data()));
            });
            lista.sort(function (a, b) {
                return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
            });
            return { sucesso: true, lista: lista };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, lista: [], mensagem: ultimoErro };
        }
    }

    async function sincronizarRelatorio(rel) {
        if (!iniciar() || !db || !rel) return { sucesso: false };
        try {
            const id = rel.id || ('rel-' + Date.now());
            await db.collection('relatorios_celula').doc(String(id)).set(
                Object.assign({}, rel, { id: id }),
                { merge: true }
            );
            return { sucesso: true };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }

    async function buscarRelatorios(celulaId) {
        if (!iniciar() || !db) return { sucesso: false, lista: [], mensagem: ultimoErro };
        try {
            let snap;
            if (celulaId) {
                snap = await db.collection('relatorios_celula').where('celulaId', '==', celulaId).get();
            } else {
                snap = await db.collection('relatorios_celula').get();
            }
            const lista = [];
            snap.forEach(function (doc) {
                lista.push(Object.assign({ id: doc.id }, doc.data()));
            });
            lista.sort(function (a, b) {
                return String(b.data || '').localeCompare(String(a.data || ''));
            });
            return { sucesso: true, lista: lista };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, lista: [], mensagem: ultimoErro };
        }
    }

    /** CSV de membros — mesmo formato do painel admin */
    function csvMembros(lista) {
        // Preferência: exportação padronizada do conta.js (se existir)
        if (typeof exportarMembrosCSVDefinido === 'function') {
            try { return exportarMembrosCSVDefinido(lista || []); } catch (e) {}
        }
        const sep = ';';
        const header = [
            'Nome', 'Telefone', 'E-mail', 'Sexo', 'Nascimento', 'Estado Civil',
            'Endereço', 'Município', 'UF', 'Origem', 'Batizado', 'Data Batismo',
            'Cargo', 'Função específica', 'Lidera célula', 'Lidera ministério',
            'Nível', 'Status', 'Células', 'Ministérios', 'Observações', 'Data Cadastro'
        ].join(sep);
        const linhas = (lista || []).map(function (m) {
            const celulas = Array.isArray(m.celulas)
                ? m.celulas.map(function (c) { return c.nome || c.id || c; }).join(' | ')
                : '';
            const ministerios = Array.isArray(m.ministerios) ? m.ministerios.join(' | ') : (m.ministerios || '');
            const bat = (m.batizado === true || m.batizado === 'sim' || m.batizado === 'Sim') ? 'Sim'
                : (m.batizado === false || m.batizado === 'nao' || m.batizado === 'Não') ? 'Não'
                : (m.batizado || '');
            function q(v) {
                return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
            }
            var nomeCelLider = m.lideraCelulaId || '';
            if (m.lideraCelulaId && typeof LISTA_CELULAS !== 'undefined') {
                var celL = LISTA_CELULAS.find(function(c){ return c.id === m.lideraCelulaId; });
                if (celL) nomeCelLider = celL.nome;
            }
            return [
                q(m.nome), q(m.telefone), q(m.email), q(m.sexo), q(m.nascimento),
                q(m.estadoCivil), q(m.endereco), q(m.municipio), q(m.uf), q(m.origem),
                q(bat), q(m.dataBatismo),
                q(m.cargo), q(m.funcaoEspecifica), q(nomeCelLider), q(m.lideraMinisterio),
                q(m.nivel), q(m.status), q(celulas), q(ministerios),
                q(m.observacoes), q(m.dataCadastro)
            ].join(sep);
        });
        return '\uFEFF' + header + '\n' + linhas.join('\n');
    }

    /** CSV de relatórios de célula — mesmo formato de exportarRelatoriosCSV */
    function csvRelatorios(lista, listaCelulas) {
        const sep = ';';
        const header = ['Data', 'Célula', 'Qtd presentes', 'Oferta PIX', 'Oferta espécie', 'Total ofertas', 'Observações', 'Registrado por'].join(sep);
        const linhas = (lista || []).map(function (r) {
            let nomeCel = r.celulaId || '';
            if (listaCelulas && listaCelulas.length) {
                const cel = listaCelulas.find(function (c) { return c.id === r.celulaId; });
                if (cel) nomeCel = cel.nome;
            }
            function q(v) {
                return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
            }
            function money(n) {
                return (parseFloat(n) || 0).toFixed(2).replace('.', ',');
            }
            return [
                r.data || '',
                q(nomeCel),
                r.qtdPresentes || 0,
                money(r.ofertaPix),
                money(r.ofertaEspecie),
                money(r.totalOfertas),
                q(r.observacoes),
                q(r.autorNome)
            ].join(sep);
        });
        return '\uFEFF' + header + '\n' + linhas.join('\n');
    }

    function baixarArquivo(conteudo, nomeArquivo) {
        const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nomeArquivo || 'export.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async function exportarMembrosCSV() {
        const r = await buscarMembros();
        if (!r.sucesso) return r;
        if (!r.lista.length) return { sucesso: false, mensagem: 'Nenhum membro na nuvem ainda.' };
        baixarArquivo(csvMembros(r.lista), (typeof dataArquivoBR === 'function' ? ('membros-ibn-nuvem_' + dataArquivoBR() + '.csv') : 'membros-ibn-nuvem.csv'));
        return { sucesso: true, quantidade: r.lista.length };
    }

    async function exportarRelatoriosCSV(celulaId) {
        const r = await buscarRelatorios(celulaId || null);
        if (!r.sucesso) return r;
        if (!r.lista.length) return { sucesso: false, mensagem: 'Nenhum relatório na nuvem ainda.' };
        const celulas = (typeof LISTA_CELULAS !== 'undefined') ? LISTA_CELULAS : [];
        const nome = celulaId ? ('relatorios-celula-' + celulaId + '-nuvem.csv') : 'relatorios-celulas-geral-nuvem.csv';
        baixarArquivo(csvRelatorios(r.lista, celulas), nome);
        return { sucesso: true, quantidade: r.lista.length };
    }

    // ---------- FOTOS (ministérios) ----------
    async function salvarFotoNuvem(foto) {
        // Fotos de ministerio: arquivo no R2, so o link no Firestore (nao estoura cota)
        if (!iniciar() || !db || !foto) return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponivel' };
        try {
            const id = String(foto.id || ('foto-' + Date.now()));
            let src = foto.imagemUrl || foto.url || foto.imagem || '';
            let publicUrl = '';

            if (src && String(src).indexOf('http') === 0) {
                publicUrl = src;
            } else if (src && String(src).indexOf('data:') === 0) {
                if (r2Ativo()) {
                    var blob = dataUrlParaBlob(src);
                    var ext = (blob.type || '').indexOf('png') >= 0 ? 'png' : 'jpg';
                    var key = 'ministerios/' + id + '.' + ext;
                    publicUrl = await uploadParaR2(blob, key, blob.type || 'image/jpeg');
                    const docR2 = {
                        id: id,
                        titulo: foto.titulo || '',
                        ministerio: foto.ministerio || '',
                        autor: foto.autor || '',
                        autorId: foto.autorId || '',
                        dataFormatada: foto.dataFormatada || '',
                        mesAno: foto.mesAno || '',
                        imagemUrl: publicUrl,
                        url: publicUrl,
                        imagem: '',
                        criadoEm: foto.criadoEm || foto.dataEnvio || new Date().toISOString()
                    };
                    await db.collection('fotos').doc(id).set(docR2, { merge: true });
                    return { sucesso: true, foto: Object.assign({}, docR2, { imagem: publicUrl, url: publicUrl }) };
                }
                // Fallback: grava base64 no Firestore (R2 ainda nao ativo)
                if (String(src).length > 900000) {
                    throw new Error('Foto grande demais para a nuvem. Use outra com menos resolucao.');
                }
                const docFs = {
                    id: id,
                    titulo: foto.titulo || '',
                    ministerio: foto.ministerio || '',
                    autor: foto.autor || '',
                    autorId: foto.autorId || '',
                    dataFormatada: foto.dataFormatada || '',
                    mesAno: foto.mesAno || '',
                    imagemUrl: '',
                    url: '',
                    imagem: src,
                    criadoEm: foto.criadoEm || foto.dataEnvio || new Date().toISOString()
                };
                await db.collection('fotos').doc(id).set(docFs, { merge: true });
                return { sucesso: true, foto: Object.assign({}, docFs, { imagem: src, url: src }) };
            } else {
                throw new Error('Nenhuma imagem valida para enviar.');
            }

            const doc = {
                id: id,
                titulo: foto.titulo || '',
                ministerio: foto.ministerio || '',
                autor: foto.autor || '',
                autorId: foto.autorId || '',
                dataFormatada: foto.dataFormatada || '',
                mesAno: foto.mesAno || '',
                imagemUrl: publicUrl,
                url: publicUrl,
                imagem: '',
                criadoEm: foto.criadoEm || foto.dataEnvio || new Date().toISOString()
            };
            await db.collection('fotos').doc(id).set(doc, { merge: true });
            return { sucesso: true, foto: Object.assign({}, doc, { imagem: publicUrl, url: publicUrl }) };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            console.warn('salvarFotoNuvem:', ultimoErro);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }

    async function buscarFotos() {
        if (!iniciar() || !db) return { sucesso: false, lista: [], mensagem: ultimoErro };
        try {
            const snap = await db.collection('fotos').get();
            const lista = [];
            snap.forEach(function (doc) {
                const d = Object.assign({ id: doc.id }, doc.data());
                // normaliza para a galeria e para a prévia da home
                var src = d.imagemUrl || d.url || d.imagem || '';
                d.imagem = src;
                d.imagemUrl = d.imagemUrl || (src.indexOf('http') === 0 ? src : '');
                d.url = d.url || src;
                lista.push(d);
            });
            lista.sort(function (a, b) {
                return String(b.criadoEm || '').localeCompare(String(a.criadoEm || ''));
            });
            return { sucesso: true, lista: lista };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, lista: [], mensagem: ultimoErro };
        }
    }

    // ---------- FOTOS DE CÉLULA ----------
    async function salvarFotoCelulaNuvem(foto) {
        // Fotos de celula: arquivo no R2, so o link no Firestore
        if (!iniciar() || !db || !foto) return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponivel' };
        try {
            const id = String(foto.id || ('fc-' + Date.now()));
            let src = foto.url || foto.imagemUrl || foto.imagem || '';
            let publicUrl = '';

            if (src && String(src).indexOf('http') === 0) {
                publicUrl = src;
            } else if (src && String(src).indexOf('data:') === 0) {
                if (r2Ativo()) {
                    var blob = dataUrlParaBlob(src);
                    var ext = (blob.type || '').indexOf('png') >= 0 ? 'png' : 'jpg';
                    var key = 'celulas/' + id + '.' + ext;
                    publicUrl = await uploadParaR2(blob, key, blob.type || 'image/jpeg');
                    const docR2 = {
                        id: id,
                        celulaId: foto.celulaId || '',
                        titulo: foto.titulo || '',
                        autorNome: foto.autorNome || foto.autor || '',
                        autorId: foto.autorId || '',
                        data: foto.data || foto.criadoEm || new Date().toISOString(),
                        url: publicUrl,
                        imagemUrl: publicUrl,
                        imagem: ''
                    };
                    await db.collection('fotos_celulas').doc(id).set(docR2, { merge: true });
                    return { sucesso: true, foto: Object.assign({}, docR2, { url: publicUrl, imagem: publicUrl }) };
                }
                if (String(src).length > 900000) {
                    throw new Error('Foto grande demais para a nuvem. Use outra com menos resolucao.');
                }
                const docFs = {
                    id: id,
                    celulaId: foto.celulaId || '',
                    titulo: foto.titulo || '',
                    autorNome: foto.autorNome || foto.autor || '',
                    autorId: foto.autorId || '',
                    data: foto.data || foto.criadoEm || new Date().toISOString(),
                    url: '',
                    imagemUrl: '',
                    imagem: src
                };
                await db.collection('fotos_celulas').doc(id).set(docFs, { merge: true });
                return { sucesso: true, foto: Object.assign({}, docFs, { url: src, imagem: src }) };
            } else {
                throw new Error('Nenhuma imagem valida para enviar.');
            }

            const doc = {
                id: id,
                celulaId: foto.celulaId || '',
                titulo: foto.titulo || '',
                autorNome: foto.autorNome || foto.autor || '',
                autorId: foto.autorId || '',
                data: foto.data || foto.criadoEm || new Date().toISOString(),
                url: publicUrl,
                imagemUrl: publicUrl,
                imagem: ''
            };
            await db.collection('fotos_celulas').doc(id).set(doc, { merge: true });
            return { sucesso: true, foto: Object.assign({}, doc, { url: publicUrl, imagem: publicUrl }) };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            console.warn('salvarFotoCelulaNuvem:', ultimoErro);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }

    async function buscarFotosCelulas    async function buscarFotosCelulas() {
        if (!iniciar() || !db) return { sucesso: false, lista: [], mensagem: ultimoErro };
        try {
            const snap = await db.collection('fotos_celulas').get();
            const lista = [];
            snap.forEach(function (doc) {
                const d = Object.assign({ id: doc.id }, doc.data());
                d.url = d.url || d.imagemUrl || d.imagem || '';
                d.imagem = d.imagem || d.url || d.imagemUrl || '';
                lista.push(d);
            });
            lista.sort(function (a, b) {
                return String(b.data || '').localeCompare(String(a.data || ''));
            });
            return { sucesso: true, lista: lista };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, lista: [], mensagem: ultimoErro };
        }
    }

    // ---------- LOG DE ATIVIDADES (gestão) ----------
    function lerAtividadesLocal() {
        try {
            var a = JSON.parse(localStorage.getItem('ibn_atividades_log') || '[]');
            return Array.isArray(a) ? a : [];
        } catch (e) { return []; }
    }
    function salvarAtividadeLocal(doc) {
        try {
            var lista = lerAtividadesLocal();
            lista.unshift(doc);
            localStorage.setItem('ibn_atividades_log', JSON.stringify(lista.slice(0, 300)));
        } catch (e) {}
    }

    async function registrarAtividade(tipo, detalhe, usuario) {
        const u = usuario || (typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null) || {};
        const id = 'act-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        const doc = {
            id: id,
            tipo: tipo || 'outro',
            detalhe: detalhe || '',
            usuarioId: u.id || '',
            usuarioNome: u.nome || u.usuario || '',
            quando: new Date().toISOString()
        };
        // sempre grava local (fallback se a nuvem falhar)
        salvarAtividadeLocal(doc);
        if (!iniciar() || !db) return { sucesso: true, local: true };
        try {
            await db.collection('atividades').doc(id).set(doc);
            return { sucesso: true };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            // local já salvou
            return { sucesso: true, aviso: ultimoErro };
        }
    }

    async function buscarAtividades(limite) {
        const n = limite || 200;
        var local = lerAtividadesLocal();
        var nuvem = [];
        if (iniciar() && db) {
            try {
                // tenta ordenado (mais recentes primeiro)
                var snap;
                try {
                    snap = await db.collection('atividades').orderBy('quando', 'desc').limit(n).get();
                } catch (eOrd) {
                    // sem índice / regra: busca tudo e ordena no cliente
                    snap = await db.collection('atividades').get();
                }
                snap.forEach(function (doc) {
                    var d = doc.data() || {};
                    if (!d.id) d.id = doc.id;
                    nuvem.push(d);
                });
            } catch (e) {
                ultimoErro = (e && e.message) || String(e);
            }
        }
        // mescla local + nuvem por id
        var map = {};
        local.forEach(function (a) { if (a && a.id) map[a.id] = a; });
        nuvem.forEach(function (a) { if (a && a.id) map[a.id] = a; });
        var lista = Object.keys(map).map(function (k) { return map[k]; });
        lista.sort(function (a, b) {
            return String(b.quando || '').localeCompare(String(a.quando || ''));
        });
        // atualiza cache local com a mescla
        try { localStorage.setItem('ibn_atividades_log', JSON.stringify(lista.slice(0, 300))); } catch (e2) {}
        if (!lista.length && ultimoErro) {
            return { sucesso: false, lista: [], mensagem: ultimoErro || 'Não foi possível carregar atividades.' };
        }
        return { sucesso: true, lista: lista.slice(0, n) };
    }

    /** Mescla lista da nuvem no localStorage (fotos ministérios) */
    async function puxarFotosParaLocal() {
        const r = await buscarFotos();
        if (!r.sucesso) return r;
        try {
            // Nuvem é a fonte da verdade: o que foi apagado na nuvem some do aparelho
            // (inclusive no aparelho de quem postou, na próxima sincronização).
            const local = JSON.parse(localStorage.getItem('ibn_fotos') || '[]');
            const porIdLocal = {};
            local.forEach(function (f) { if (f && f.id) porIdLocal[String(f.id)] = f; });
            const listaNuvem = Array.isArray(r.lista) ? r.lista : [];
            const mesclada = listaNuvem.map(function (f) {
                const id = String(f.id);
                const ant = porIdLocal[id];
                if (!ant) return f;
                const j = Object.assign({}, ant, f);
                if (f.imagem) j.imagem = f.imagem;
                if (f.imagemUrl) j.imagemUrl = f.imagemUrl;
                return j;
            });
            mesclada.sort(function (a, b) {
                return String(b.criadoEm || b.id || '').localeCompare(String(a.criadoEm || a.id || ''));
            });
            localStorage.setItem('ibn_fotos', JSON.stringify(mesclada));
            return { sucesso: true, lista: mesclada };
        } catch (e) {
            return { sucesso: false, mensagem: String(e) };
        }
    }

    async function puxarFotosCelulasParaLocal() {
        const r = await buscarFotosCelulas();
        if (!r.sucesso) return r;
        try {
            // Nuvem manda: fotos apagadas na nuvem saem do aparelho ao sincronizar
            const local = JSON.parse(localStorage.getItem('ibn_fotos_celulas') || '[]');
            const porIdLocal = {};
            local.forEach(function (f) { if (f && f.id) porIdLocal[String(f.id)] = f; });
            const listaNuvem = Array.isArray(r.lista) ? r.lista : [];
            const mesclada = listaNuvem.map(function (f) {
                const id = String(f.id);
                return Object.assign({}, porIdLocal[id] || {}, f);
            });
            localStorage.setItem('ibn_fotos_celulas', JSON.stringify(mesclada));
            return { sucesso: true, lista: mesclada };
        } catch (e) {
            return { sucesso: false, mensagem: String(e) };
        }
    }


    async function sincronizarVisitante(v) {
        if (!iniciar() || !db || !v || !v.id) return { sucesso: false };
        try {
            await db.collection('visitantes').doc(String(v.id)).set(v, { merge: true });
            return { sucesso: true };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }
    async function removerVisitanteNuvem(id) {
        if (!iniciar() || !db || !id) return { sucesso: false };
        try {
            await db.collection('visitantes').doc(String(id)).delete();
            return { sucesso: true };
        } catch (e) {
            return { sucesso: false, mensagem: (e && e.message) || String(e) };
        }
    }
    async function puxarVisitantesParaLocal() {
        if (!iniciar() || !db) return { sucesso: false, mensagem: ultimoErro };
        try {
            const snap = await db.collection('visitantes').get();
            const lista = [];
            snap.forEach(function (doc) { lista.push(Object.assign({ id: doc.id }, doc.data())); });
            localStorage.setItem('ibn_visitantes', JSON.stringify(lista));
            return { sucesso: true, lista: lista };
        } catch (e) {
            return { sucesso: false, mensagem: (e && e.message) || String(e) };
        }
    }

    async function removerMembroNuvem(id) {
        if (!iniciar() || !db || !id) return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponível' };
        try {
            await db.collection('membros').doc(String(id)).delete();
            return { sucesso: true };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }

    async function removerFotoNuvem(id) {
        if (!iniciar() || !db || !id) return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponível' };
        try {
            await db.collection('fotos').doc(String(id)).delete();
            return { sucesso: true };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }

    async function removerFotoCelulaNuvem(id) {
        if (!iniciar() || !db || !id) return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponível' };
        try {
            await db.collection('fotos_celulas').doc(String(id)).delete();
            return { sucesso: true };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }

    /** Envia para a nuvem tudo que está no localStorage deste aparelho (uma vez) */
    async function enviarTudoDoAparelho(onProgress) {
        if (!iniciar()) return { sucesso: false, mensagem: ultimoErro };
        function prog(a, b, etapa) {
            if (typeof onProgress === 'function') {
                try { onProgress(a, b, etapa); } catch (e) {}
            }
        }
        const membros = (typeof lerMembros === 'function') ? lerMembros() : [];
        const rels = (typeof lerRelatoriosCelula === 'function') ? lerRelatoriosCelula() : [];
        // Membros em lote forçado (rápido) — o que trava era get+set um a um + fotos pesadas
        prog(0, membros.length, 'membros');
        const r1 = await sincronizarMembros(membros, {
            force: true,
            onProgress: function (a, b) { prog(a, b, 'membros'); }
        });
        let okRel = 0;
        for (let i = 0; i < rels.length; i++) {
            try {
                const rr = await sincronizarRelatorio(rels[i]);
                if (rr.sucesso) okRel++;
            } catch (eR) {}
            if (i % 3 === 0) prog(i + 1, rels.length, 'relatorios');
        }
        // Fotos: no máximo 15 e pula base64 enorme (evita ficar em "Enviando..." minutos)
        let okFoto = 0;
        let puladas = 0;
        try {
            const fotos = JSON.parse(localStorage.getItem('ibn_fotos') || '[]');
            const maxF = Math.min(fotos.length, 15);
            for (let i = 0; i < maxF; i++) {
                var f = fotos[i];
                var dataUrl = (f && (f.dataUrl || f.src || f.base64)) || '';
                if (String(dataUrl).length > 900000) { puladas++; continue; }
                try {
                    const rf = await salvarFotoNuvem(f);
                    if (rf.sucesso) okFoto++;
                } catch (eF) {}
                prog(i + 1, maxF, 'fotos');
            }
            if (fotos.length > 15) puladas += (fotos.length - 15);
        } catch (e) {}
        let okFc = 0;
        try {
            const fcs = JSON.parse(localStorage.getItem('ibn_fotos_celulas') || '[]');
            const maxC = Math.min(fcs.length, 15);
            for (let i = 0; i < maxC; i++) {
                var fc = fcs[i];
                var du = (fc && (fc.dataUrl || fc.src || fc.base64)) || '';
                if (String(du).length > 900000) { puladas++; continue; }
                try {
                    const rf = await salvarFotoCelulaNuvem(fc);
                    if (rf.sucesso) okFc++;
                } catch (eC) {}
            }
        } catch (e) {}
        return {
            sucesso: !!(r1 && r1.sucesso),
            mensagem: 'Membros enviados: ' + (r1.quantidade || 0) + '/' + membros.length +
                ' · Relatórios: ' + okRel + '/' + rels.length +
                ' · Fotos: ' + okFoto + ' · Célula: ' + okFc +
                (puladas ? ' · (' + puladas + ' fotos grandes/extras puladas — sobem depois uma a uma)' : ''),
            membros: r1.quantidade || 0,
            ignorados: r1.ignorados || 0,
            relatorios: okRel
        };
    }


    async function salvarPedidoOracao(item) {
        if (!iniciar() || !db || !item) return { sucesso: false, mensagem: ultimoErro };
        try {
            const id = String(item.id || ('oracao-' + Date.now()));
            await db.collection('pedidos_oracao').doc(id).set(Object.assign({}, item, { id: id }), { merge: true });
            return { sucesso: true };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }

    async function buscarPedidosOracao() {
        if (!iniciar() || !db) return { sucesso: false, lista: [], mensagem: ultimoErro };
        try {
            const snap = await db.collection('pedidos_oracao').get();
            const lista = [];
            snap.forEach(function (doc) { lista.push(doc.data()); });
            lista.sort(function (a, b) {
                return String(b.criadoEm || '').localeCompare(String(a.criadoEm || ''));
            });
            return { sucesso: true, lista: lista };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, lista: [], mensagem: ultimoErro };
        }
    }

    async function puxarPedidosOracaoParaLocal() {
        const r = await buscarPedidosOracao();
        if (!r.sucesso) return r;
        try {
            const local = JSON.parse(localStorage.getItem('ibn_pedidos_oracao') || '[]');
            const porId = {};
            local.forEach(function (p) { if (p && p.id) porId[String(p.id)] = p; });
            r.lista.forEach(function (p) { porId[String(p.id)] = Object.assign({}, porId[String(p.id)] || {}, p); });
            const mesclada = Object.keys(porId).map(function (k) { return porId[k]; });
            mesclada.sort(function (a, b) {
                return String(b.criadoEm || '').localeCompare(String(a.criadoEm || ''));
            });
            localStorage.setItem('ibn_pedidos_oracao', JSON.stringify(mesclada));
            return { sucesso: true, lista: mesclada };
        } catch (e) {
            return { sucesso: false, mensagem: String(e) };
        }
    }


    /**
     * Sincronização silenciosa ao login / abrir o site:
     * envia o membro logado + fotos dele que estão só neste aparelho.
     * Não exige o membro saber de nada.
     */
    async function sincronizarSessaoMembro(usuario) {
        if (!usuario) {
            try {
                if (typeof getUsuarioLogado === 'function') usuario = getUsuarioLogado();
            } catch (e) {}
        }
        if (!usuario || !usuario.id) return { sucesso: false, mensagem: 'Sem sessão' };
        if (!iniciar()) return { sucesso: false, mensagem: ultimoErro || 'Nuvem offline' };

        // Cadastro ainda pendente de subir? Nunca pular por throttle
        var pendenteNuvem = false;
        try {
            pendenteNuvem = (typeof temPendenteNuvem === 'function' && temPendenteNuvem(usuario.id)) ||
                (String(usuario.status || '').toLowerCase() === 'pendente');
        } catch (ePend) {}

        // Evita spam: no máximo 1x a cada 3 minutos — EXCETO se cadastro ainda não subiu
        if (!pendenteNuvem) {
            try {
                var chave = 'ibn_sync_sessao_' + String(usuario.id);
                var ultima = parseInt(localStorage.getItem(chave) || '0', 10);
                if (ultima && (Date.now() - ultima) < 3 * 60 * 1000) {
                    return { sucesso: true, mensagem: 'Já sincronizado há pouco', pulado: true };
                }
            } catch (e) {}
        }

        var resultados = { membro: false, fotos: 0, fotosCelula: 0, fotosPuxadas: false };

        // 1) PRIORIDADE: sobe o cadastro do membro AGORA (não espera fotos — no iPhone isso demorava)
        try {
            var completo = usuario;
            if (typeof lerMembros === 'function') {
                var lista = lerMembros() || [];
                var achado = lista.find(function (m) { return String(m.id) === String(usuario.id); });
                if (achado) completo = achado;
            }
            var rm = await sincronizarUmMembro(completo, { force: true });
            resultados.membro = !!(rm && rm.sucesso && !rm.ignorado);
            if (resultados.membro && typeof marcarPendenteNuvem === 'function') {
                try { marcarPendenteNuvem(completo.id, false); } catch (eM) {}
            }
        } catch (e) {
            console.warn('sync sessão membro:', e);
        }

        // Fotos NÃO sincronizam mais aqui (economiza centenas de milhares de leituras).
        // Cadastro do membro já foi enviado acima com force.

        try {
            localStorage.setItem('ibn_sync_sessao_' + String(usuario.id), String(Date.now()));
        } catch (e) {}

        return {
            sucesso: !!resultados.membro,
            mensagem: 'Sessão sync',
            detalhes: resultados
        };
    }

    /** Agenda sync ao abrir página (não trava a tela) */
    function agendarSyncSessao(usuario, atrasoMs) {
        atrasoMs = atrasoMs == null ? 1200 : atrasoMs;
        setTimeout(function () {
            sincronizarSessaoMembro(usuario).catch(function (e) {
                console.warn('agendarSyncSessao:', e);
            });
        }, atrasoMs);
    }


    function normalizarChaveMinisterio(nome) {
        return String(nome || '').trim();
    }
    function mesclarLinhasEscala(localLinhas, nuvemLinhas) {
        var por = {};
        (localLinhas || []).concat(nuvemLinhas || []).forEach(function (l) {
            if (!l) return;
            var k = String(l.dataIso || '') || String(l.dataLabel || '');
            if (!k) return;
            var prev = por[k];
            if (!prev) { por[k] = l; return; }
            var t1 = Date.parse(prev.atualizadoEm || '') || 0;
            var t2 = Date.parse(l.atualizadoEm || '') || 0;
            // se empate de data, prefere quem tem mais funções preenchidas
            if (t2 > t1) por[k] = l;
            else if (t2 === t1) {
                var n1 = Object.keys(prev.funcoes || {}).length;
                var n2 = Object.keys(l.funcoes || {}).length;
                por[k] = n2 >= n1 ? l : prev;
            }
        });
        return Object.keys(por).map(function (k) { return por[k]; });
    }
    
    async function sincronizarEscalaCelula(celulaId, linhas) {
        if (!iniciar() || !db) return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponível' };
        try {
            var id = String(celulaId || 'geral').toLowerCase().replace(/\s+/g, '_');
            await db.collection('escalas_celula').doc(id).set({
                celulaId: celulaId || '',
                linhas: linhas || [],
                atualizadoEm: new Date().toISOString()
            }, { merge: false });
            return { sucesso: true };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }
    async function puxarEscalasCelulaParaLocal() {
        if (!iniciar() || !db) return { sucesso: false };
        try {
            var snap = await db.collection('escalas_celula').get();
            var all = {};
            try { all = JSON.parse(localStorage.getItem('ibn_escala_celulas') || '{}'); } catch (e) { all = {}; }
            snap.forEach(function (doc) {
                var d = doc.data() || {};
                var cid = d.celulaId || doc.id;
                var nuvem = Array.isArray(d.linhas) ? d.linhas : [];
                var local = Array.isArray(all[cid]) ? all[cid] : [];
                var por = {};
                local.concat(nuvem).forEach(function (l) {
                    if (!l) return;
                    var k = String(l.dataIso || l.dataLabel || '');
                    if (!k) return;
                    var prev = por[k];
                    if (!prev) { por[k] = l; return; }
                    var t1 = Date.parse(prev.atualizadoEm || '') || 0;
                    var t2 = Date.parse(l.atualizadoEm || '') || 0;
                    por[k] = t2 >= t1 ? l : prev;
                });
                all[cid] = Object.keys(por).map(function (k) { return por[k]; });
            });
            localStorage.setItem('ibn_escala_celulas', JSON.stringify(all));
            return { sucesso: true };
        } catch (e) {
            return { sucesso: false, mensagem: (e && e.message) || String(e) };
        }
    }

    async function sincronizarEscalaMinisterio(ministerio, linhas) {
        if (!iniciar() || !db) return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponível' };
        try {
            var min = normalizarChaveMinisterio(ministerio) || 'Atmosfera';
            var id = min.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
            var payload = {
                ministerio: min,
                linhas: linhas || [],
                atualizadoEm: new Date().toISOString()
            };
            await db.collection('escalas_ministerio').doc(id).set(payload, { merge: false });
            // backup: mapa completo no aparelho também sobe (ajuda outros aparelhos)
            try {
                var all = {};
                try { all = JSON.parse(localStorage.getItem('ibn_escala_cultos') || '{}'); } catch (e2) { all = {}; }
                all[min] = linhas || [];
                await db.collection('config').doc('escalas_todas').set({
                    mapa: all,
                    atualizadoEm: new Date().toISOString()
                }, { merge: true });
            } catch (e3) { console.warn('backup escalas_todas', e3); }
            return { sucesso: true };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }
    async function puxarEscalasParaLocal() {
        if (!iniciar() || !db) return { sucesso: false, mensagem: ultimoErro || 'Nuvem offline' };
        try {
            var all = {};
            try { all = JSON.parse(localStorage.getItem('ibn_escala_cultos') || '{}'); } catch (e) { all = {}; }
            // 1) backup completo
            try {
                var snapAll = await db.collection('config').doc('escalas_todas').get();
                if (snapAll.exists) {
                    var mapa = (snapAll.data() || {}).mapa || {};
                    Object.keys(mapa).forEach(function (min) {
                        var nome = normalizarChaveMinisterio(min);
                        all[nome] = mesclarLinhasEscala(all[nome], mapa[min]);
                    });
                }
            } catch (eB) { console.warn('puxar escalas_todas', eB); }
            // 2) por ministério
            var snap = await db.collection('escalas_ministerio').get();
            snap.forEach(function (doc) {
                var d = doc.data() || {};
                var min = normalizarChaveMinisterio(d.ministerio || doc.id);
                // tenta casar chave existente (Atmosfera vs atmosfera)
                var chaveLocal = min;
                Object.keys(all).forEach(function (k) {
                    if (k.toLowerCase() === min.toLowerCase()) chaveLocal = k;
                });
                all[chaveLocal] = mesclarLinhasEscala(all[chaveLocal], d.linhas || []);
            });
            localStorage.setItem('ibn_escala_cultos', JSON.stringify(all));
            var total = 0;
            Object.keys(all).forEach(function (k) { total += (all[k] || []).length; });
            return { sucesso: true, totalDias: total };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }



    var _syncTimer = null;
    var _syncBusy = false;
    // ---- Economia de leituras (Spark estourou com ~840 mil reads/dia) ----
    var CHAVE_ULTIMO_PULL = 'ibn_nuvem_ultimo_pull_ms';
    var INTERVALO_PULL_MS = 10 * 60 * 1000; // 10 min entre pulls automáticos
    var _ultimoPullMs = 0;
    try { _ultimoPullMs = parseInt(localStorage.getItem(CHAVE_ULTIMO_PULL) || '0', 10) || 0; } catch (eU) {}

    function _marcarPullOk() {
        _ultimoPullMs = Date.now();
        try { localStorage.setItem(CHAVE_ULTIMO_PULL, String(_ultimoPullMs)); } catch (e) {}
    }

    function _pullMuitoRecente(forcar) {
        if (forcar) return false;
        return _ultimoPullMs && (Date.now() - _ultimoPullMs) < INTERVALO_PULL_MS;
    }

    /**
     * motivo:
     *  - gestao-manual / manual / gestao-auto → full (membros)
     *  - inicio / periodico / foco → leve e com throttle 10 min
     *  - leve → só config (poucos docs), sem lista de membros/fotos
     */
    async function sincronizarTudoDaNuvem(motivo) {
        if (_syncBusy) return { sucesso: false, ocupado: true };
        motivo = String(motivo || '');
        var forcar = /manual|gestao-manual|login|cadastro/i.test(motivo);
        var precisaMembros = forcar || /gestao|aprov|membro/i.test(motivo);
        // Automático: no máximo 1x a cada 10 min (vários celulares abertos não matam a cota)
        if (!forcar && !precisaMembros && _pullMuitoRecente(false)) {
            return { sucesso: true, pulou: true, motivo: 'throttle_10min' };
        }
        _syncBusy = true;
        try {
            // MEMBROS: só quando gestão/manual ou a cada 10+ min no automático
            if (precisaMembros || !_pullMuitoRecente(forcar)) {
                if (precisaMembros || /inicio|periodico|foco|focus/i.test(motivo) || !motivo) {
                    try { await puxarMembrosParaLocal(); } catch (e1) {}
                    try { await puxarExcluidosParaLocal(); } catch (e2) {}
                }
            }
            // Escalas: raras — só manual/gestão ou 1x no início da sessão (não a cada tick)
            if (forcar || /gestao|inicio/i.test(motivo)) {
                try { if (typeof puxarEscalasParaLocal === 'function') await puxarEscalasParaLocal(); } catch (e3) {}
                try { if (typeof puxarEscalasCelulaParaLocal === 'function') await puxarEscalasCelulaParaLocal(); } catch (e4) {}
            }
            // FOTOS: NÃO puxar no sync automático (era o maior vilão de leituras).
            // Só em pedido manual explícito.
            if (/foto|manual-fotos/i.test(motivo) && forcar) {
                try { if (typeof puxarFotosParaLocal === 'function') await puxarFotosParaLocal(); } catch (e5) {}
                try { if (typeof puxarFotosCelulasParaLocal === 'function') await puxarFotosCelulasParaLocal(); } catch (e6) {}
            }
            // Config: poucos documentos (barato)
            try {
                if (db) {
                    var snapA = await db.collection('config').doc('agenda_futebol_homens').get();
                    if (snapA.exists) {
                        var d = snapA.data() || {};
                        var lista = d.itens || d.lista || [];
                        if (Array.isArray(lista)) localStorage.setItem('ibn_agenda_futebol_homens', JSON.stringify(lista));
                    }
                    var snapC = await db.collection('config').doc('catalogo_futebol_homens').get();
                    if (snapC.exists) {
                        var dc = snapC.data() || {};
                        var itens = dc.itens || [];
                        if (Array.isArray(itens)) localStorage.setItem('ibn_catalogo_locais_futebol', JSON.stringify(itens));
                    }
                    var snapCel = await db.collection('config').doc('lista_celulas').get();
                    if (snapCel.exists) {
                        var dCel = snapCel.data() || {};
                        var listaCel = dCel.itens || dCel.lista || [];
                        if (Array.isArray(listaCel) && listaCel.length) {
                            localStorage.setItem('ibn_lista_celulas', JSON.stringify(listaCel));
                            try {
                                if (typeof carregarListaCelulas === 'function') carregarListaCelulas();
                            } catch (eCel) {}
                        }
                    }
                    var snapEv = await db.collection('config').doc('eventos_site').get();
                    if (snapEv.exists) {
                        var dEv = snapEv.data() || {};
                        var listaEv = dEv.itens || dEv.lista || [];
                        if (Array.isArray(listaEv) && listaEv.length) {
                            localStorage.setItem('ibn_eventos', JSON.stringify(listaEv));
                            try { localStorage.setItem('eventos', JSON.stringify(listaEv)); } catch (eEv2) {}
                        }
                    }
                }
            } catch (e7) {}
            _marcarPullOk();
            try { window.dispatchEvent(new CustomEvent('ibn-nuvem-sincronizado', { detail: { motivo: motivo || '' } })); } catch (e8) {}
            return { sucesso: true };
        } finally {
            _syncBusy = false;
        }
    }
    function agendarSincronizacaoPeriodica() {
        // MODO MANUAL (economia de cota):
        // - NÃO puxa membros sozinho ao abrir o site
        // - NÃO fica em loop de 30s/15min
        // - NÃO sincroniza ao focar a aba
        // Gestão baixa/sobe só nos botões; membro só envia o próprio cadastro se faltar na nuvem.
        if (_syncTimer) {
            clearInterval(_syncTimer);
            _syncTimer = null;
        }
        // Só garante Firebase inicializado (0 leitura de membros)
        setTimeout(function () {
            try { iniciar(); } catch (e) {}
        }, 300);
    }
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                setTimeout(function () { try { iniciar(); } catch (e) {} agendarSincronizacaoPeriodica(); }, 500);
            });
        } else {
            setTimeout(function () { try { iniciar(); } catch (e) {} agendarSincronizacaoPeriodica(); }, 500);
        }
    }


    /**
     * 1 leitura: confere se ESTE membro já tem documento na nuvem.
     * Usado para mostrar/esconder o banner "Enviar meu cadastro".
     */
    async function membroExisteNaNuvem(membroId) {
        if (membroId === undefined || membroId === null || membroId === '') {
            return { sucesso: false, existe: false, mensagem: 'id vazio' };
        }
        if (!iniciar() || !db) {
            return { sucesso: false, existe: false, mensagem: ultimoErro || 'Nuvem indisponível' };
        }
        try {
            var snap = await _comTimeout(
                db.collection('membros').doc(String(membroId)).get(),
                8000,
                'timeout_get'
            );
            if (snap && snap.__timeout) {
                return { sucesso: false, existe: false, timeout: true, mensagem: 'timeout' };
            }
            var existe = !!(snap && snap.exists);
            return { sucesso: true, existe: existe };
        } catch (e) {
            var msg = (e && (e.code || e.message)) || String(e);
            if (String(msg).indexOf('permission') !== -1) {
                return { sucesso: false, existe: false, mensagem: 'permission-denied' };
            }
            return { sucesso: false, existe: false, mensagem: msg };
        }
    }

    /** Teste rápido: tenta gravar e ler um doc de diagnóstico (sem UI). */
    async function testarConexaoNuvem() {
        if (!iniciar() || !db) {
            return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponível' };
        }
        var id = 'teste_' + Date.now();
        try {
            var ref = db.collection('membros').doc(id);
            var w = await _comTimeout(
                ref.set({ id: id, nome: '__teste_conexao__', atualizadoEm: new Date().toISOString(), _teste: true }, { merge: true })
                    .then(function () { return { ok: true }; })
                    .catch(function (e) {
                        return { ok: false, code: (e && e.code) || '', msg: (e && e.message) || String(e) };
                    }),
                10000,
                'timeout_set'
            );
            if (w && w.__timeout) {
                return { sucesso: false, mensagem: 'Timeout ao gravar. Regras do Firestore ou rede bloqueando.' };
            }
            if (w && !w.ok) {
                if (String(w.code).indexOf('permission') !== -1 || String(w.msg).indexOf('permission') !== -1) {
                    return { sucesso: false, mensagem: 'PERMISSION-DENIED: abra Firebase Console → Firestore → Regras e permita write em /membros.' };
                }
                return { sucesso: false, mensagem: w.msg || 'Falha ao gravar teste' };
            }
            try { await ref.delete(); } catch (eD) {}
            return { sucesso: true, mensagem: 'Nuvem OK — gravação de membros funcionando.' };
        } catch (e) {
            return { sucesso: false, mensagem: (e && e.message) || String(e) };
        }
    }


    // ---------- INSCRITOS DE EVENTOS ----------
    function _docInscritoLeve(insc) {
        if (!insc) return null;
        var o = Object.assign({}, insc);
        // Nao manda comprovante base64 (estoura / trava)
        if (o.comprovante && String(o.comprovante).indexOf('data:') === 0) {
            o.comprovanteEnviado = true;
            o.comprovante = '';
        }
        if (String(o.comprovante || '').length > 5000) {
            o.comprovanteEnviado = true;
            o.comprovante = '';
        }
        o.atualizadoEm = o.atualizadoEm || new Date().toISOString();
        return o;
    }

    async function salvarInscritoEventoNuvem(insc) {
        if (!iniciar() || !db || !insc) return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponivel' };
        try {
            var id = String(insc.codigo || insc.id || ('insc-' + Date.now()));
            var doc = _docInscritoLeve(Object.assign({}, insc, { id: id, codigo: insc.codigo || id }));
            await db.collection('inscritos_eventos').doc(id).set(doc, { merge: true });
            return { sucesso: true, id: id };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            console.warn('salvarInscritoEventoNuvem:', ultimoErro);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }

    async function puxarInscritosEventosParaLocal() {
        if (!iniciar() || !db) return { sucesso: false, lista: [], mensagem: ultimoErro };
        try {
            var snap = await db.collection('inscritos_eventos').get();
            var lista = [];
            snap.forEach(function (doc) {
                var d = Object.assign({ id: doc.id }, doc.data());
                if (!d.codigo) d.codigo = doc.id;
                lista.push(d);
            });
            // Mescla com local (nuvem manda / preenche faltantes)
            var local = [];
            try { local = JSON.parse(localStorage.getItem('inscritosIBN') || '[]'); } catch (e0) { local = []; }
            if (!Array.isArray(local)) local = [];
            var map = {};
            local.forEach(function (i) {
                if (!i) return;
                var k = String(i.codigo || i.id || '');
                if (k) map[k] = i;
            });
            var mudou = false;
            lista.forEach(function (n) {
                var k = String(n.codigo || n.id || '');
                if (!k) return;
                var prev = map[k];
                if (!prev) {
                    map[k] = n;
                    mudou = true;
                    return;
                }
                // Atualiza status de pagamento se nuvem estiver mais avancada
                var rank = function (x) {
                    var s = String((x && x.statusPagamento) || '');
                    if (s === 'confirmado' || (x && x.pago)) return 3;
                    if (s === 'aguardando_conferencia' || (x && x.comprovanteEnviado)) return 2;
                    return 1;
                };
                if (rank(n) > rank(prev)) {
                    map[k] = Object.assign({}, prev, n);
                    mudou = true;
                } else if (!prev.nome && n.nome) {
                    map[k] = Object.assign({}, n, prev);
                    mudou = true;
                }
            });
            var mesclada = Object.keys(map).map(function (k) { return map[k]; });
            // Ordena mais recentes primeiro
            mesclada.sort(function (a, b) {
                return String(b.dataInsc || b.atualizadoEm || '').localeCompare(String(a.dataInsc || a.atualizadoEm || ''));
            });
            localStorage.setItem('inscritosIBN', JSON.stringify(mesclada));
            return { sucesso: true, lista: mesclada, mudou: mudou, quantidade: mesclada.length };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, lista: [], mensagem: ultimoErro };
        }
    }

    async function removerInscritoEventoNuvem(codigo) {
        if (!iniciar() || !db || !codigo) return { sucesso: false, mensagem: ultimoErro };
        try {
            await db.collection('inscritos_eventos').doc(String(codigo)).delete();
            return { sucesso: true };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }


    return {
        iniciar: iniciar,
        sincronizarTudoDaNuvem: sincronizarTudoDaNuvem,
        agendarSincronizacaoPeriodica: agendarSincronizacaoPeriodica,
        status: status,
        testarConexaoNuvem: testarConexaoNuvem,
        membroExisteNaNuvem: membroExisteNaNuvem,
        sincronizarMembros: sincronizarMembros,
        sincronizarUmMembro: sincronizarUmMembro,
        buscarMembros: buscarMembros,
        puxarMembrosParaLocal: puxarMembrosParaLocal,
        puxarExcluidosParaLocal: puxarExcluidosParaLocal,
        sincronizarExcluidos: sincronizarExcluidos,

        sincronizarEscalaMinisterio: sincronizarEscalaMinisterio,
        sincronizarEscalaCelula: sincronizarEscalaCelula,
        puxarEscalasCelulaParaLocal: puxarEscalasCelulaParaLocal,
        puxarEscalasParaLocal: puxarEscalasParaLocal,
        sincronizarRelatorio: sincronizarRelatorio,
        buscarRelatorios: buscarRelatorios,
        exportarMembrosCSV: exportarMembrosCSV,
        exportarRelatoriosCSV: exportarRelatoriosCSV,
        enviarTudoDoAparelho: enviarTudoDoAparelho,
        forcarEnvioMembrosLocais: forcarEnvioMembrosLocais,
        enviarCadastrosAusentesNaNuvem: enviarCadastrosAusentesNaNuvem,
        verificarEForcarEnvioSe24h: verificarEForcarEnvioSe24h,
        precisaForceEnvio24h: precisaForceEnvio24h,
        lerUltimoEnvioMembros: lerUltimoEnvioMembros,
        msDesdeUltimoEnvioMembros: msDesdeUltimoEnvioMembros,
        sincronizarSessaoMembro: sincronizarSessaoMembro,
        agendarSyncSessao: agendarSyncSessao,
        csvMembros: csvMembros,
        csvRelatorios: csvRelatorios,
        baixarArquivo: baixarArquivo,
        sincronizarVisitante: sincronizarVisitante,
        removerVisitanteNuvem: removerVisitanteNuvem,
        puxarVisitantesParaLocal: puxarVisitantesParaLocal,
        removerMembroNuvem: removerMembroNuvem,
        salvarFotoNuvem: salvarFotoNuvem,
        buscarFotos: buscarFotos,
        removerFotoNuvem: removerFotoNuvem,
        salvarFotoCelulaNuvem: salvarFotoCelulaNuvem,
        buscarFotosCelulas: buscarFotosCelulas,
        removerFotoCelulaNuvem: removerFotoCelulaNuvem,
        registrarAtividade: registrarAtividade,
        buscarAtividades: buscarAtividades,
        puxarFotosParaLocal: puxarFotosParaLocal,
        puxarFotosCelulasParaLocal: puxarFotosCelulasParaLocal,
        salvarPedidoOracao: salvarPedidoOracao,
        buscarPedidosOracao: buscarPedidosOracao,
        puxarPedidosOracaoParaLocal: puxarPedidosOracaoParaLocal,
        salvarInscritoEventoNuvem: salvarInscritoEventoNuvem,
        puxarInscritosEventosParaLocal: puxarInscritosEventosParaLocal,
        removerInscritoEventoNuvem: removerInscritoEventoNuvem
    };
})();
