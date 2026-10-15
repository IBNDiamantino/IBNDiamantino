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

    // Envia dados do membro para a nuvem (inclui senha para login em vários aparelhos).
    // Resposta de segurança continua só no aparelho por privacidade extra.
    function membroPublico(m) {
        if (!m) return null;
        try {
            if (typeof isContaSistema === 'function' && isContaSistema(m)) return null;
        } catch (e) {}
        const copia = Object.assign({}, m);
        delete copia.respostaSeguranca;
        return copia;
    }

    async function sincronizarMembros(lista) {
        if (!iniciar() || !db) return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponível' };
        try {
            const col = db.collection('membros');
            const itens = (lista || []).filter(function (m) {
                if (!m || m.id === undefined || m.id === null || m.id === '') return false;
                try { if (typeof isContaSistema === 'function' && isContaSistema(m)) return false; } catch (e) {}
                if (typeof membroFoiExcluido === 'function' && membroFoiExcluido(m)) return false;
                return true;
            });
            // Firestore: no máximo 500 ops por batch
            const CHUNK = 400;
            let enviados = 0;
            for (let i = 0; i < itens.length; i += CHUNK) {
                const fatia = itens.slice(i, i + CHUNK);
                const batch = db.batch();
                fatia.forEach(function (m) {
                    var pub = membroPublico(m);
                    if (pub) batch.set(col.doc(String(m.id)), pub, { merge: true });
                });
                await batch.commit();
                enviados += fatia.length;
            }
            return { sucesso: true, quantidade: enviados };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            console.warn('IBNNuvem.sincronizarMembros:', ultimoErro);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }

    async function sincronizarUmMembro(m) {
        if (!m) return { sucesso: false, mensagem: 'Membro vazio' };
        if (m.id === undefined || m.id === null || m.id === '') {
            m.id = Date.now();
        }
        if (!iniciar() || !db) return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponível' };
        try {
            if (typeof isContaSistema === 'function' && isContaSistema(m)) {
                return { sucesso: false, mensagem: 'Conta de sistema não vai para a lista de membros' };
            }
            if (typeof membroFoiExcluido === 'function' && membroFoiExcluido(m)) {
                return { sucesso: false, mensagem: 'Membro na lista de excluídos' };
            }
            var pub1 = membroPublico(m);
            if (!pub1) return { sucesso: false, mensagem: 'Dados inválidos' };
            await db.collection('membros').doc(String(m.id)).set(pub1, { merge: true });
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
                var t = Date.parse((m && (m.atualizadoEm || m.criadoEm)) || '') || 0;
                return t;
            }
            const local = (typeof lerMembros === 'function') ? lerMembros() : [];
            const porId = {};
            local.forEach(function (m) {
                if (!m || m.id === undefined) return;
                if (ehSistema(m) || foiExcl(m)) return;
                porId[String(m.id)] = m;
            });
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
                if (ts(m) > ts(loc)) {
                    porId[id] = Object.assign({}, loc, m);
                } else {
                    porId[id] = Object.assign({}, m, loc);
                }
                if (!porId[id].senha && senhaLocal) porId[id].senha = senhaLocal;
                if (!porId[id].respostaSeguranca && respLocal) porId[id].respostaSeguranca = respLocal;
            });
            let mesclada = Object.keys(porId).map(function (k) { return porId[k]; });
            mesclada = mesclada.filter(function (m) { return !ehSistema(m) && !foiExcl(m); });
            localStorage.setItem('ibn_membros', JSON.stringify(mesclada));
            if (typeof deduplicarMembrosLocais === 'function') {
                mesclada = deduplicarMembrosLocais();
            }
            // Atualiza sessão logada (cargos/lideranças vindas da nuvem)
            try {
                if (typeof atualizarSessaoDoCadastro === 'function') atualizarSessaoDoCadastro();
            } catch (eSess) {}
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
        // Firestore-first (Storage costuma travar no celular sem bucket configurado)
        if (!iniciar() || !db || !foto) return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponível' };
        try {
            const id = String(foto.id || ('foto-' + Date.now()));
            let src = foto.imagemUrl || foto.url || foto.imagem || '';
            // Se for http(s), grava só o link (leve)
            if (src && String(src).indexOf('http') === 0) {
                const doc = {
                    id: id,
                    titulo: foto.titulo || '',
                    ministerio: foto.ministerio || '',
                    autor: foto.autor || '',
                    autorId: foto.autorId || '',
                    dataFormatada: foto.dataFormatada || '',
                    mesAno: foto.mesAno || '',
                    imagemUrl: src,
                    url: src,
                    imagem: '',
                    criadoEm: foto.criadoEm || foto.dataEnvio || new Date().toISOString()
                };
                await db.collection('fotos').doc(id).set(doc, { merge: true });
                return { sucesso: true, foto: doc };
            }
            // data:URL base64 — precisa caber no Firestore (~1MB)
            if (src && String(src).indexOf('data:') === 0) {
                if (String(src).length > 900000) {
                    throw new Error('Foto grande demais para a nuvem. Use outra com menos resolução.');
                }
                const doc = {
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
                await db.collection('fotos').doc(id).set(doc, { merge: true });
                return { sucesso: true, foto: Object.assign({}, doc, { imagem: src, url: src }) };
            }
            throw new Error('Nenhuma imagem válida para enviar.');
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
        // Mesma estratégia das fotos de ministério: Firestore direto
        if (!iniciar() || !db || !foto) return { sucesso: false, mensagem: ultimoErro || 'Nuvem indisponível' };
        try {
            const id = String(foto.id || ('fc-' + Date.now()));
            let src = foto.url || foto.imagemUrl || foto.imagem || '';
            if (src && String(src).indexOf('http') === 0) {
                const doc = {
                    id: id,
                    celulaId: foto.celulaId || '',
                    titulo: foto.titulo || '',
                    autorNome: foto.autorNome || foto.autor || '',
                    autorId: foto.autorId || '',
                    data: foto.data || foto.criadoEm || new Date().toISOString(),
                    url: src,
                    imagemUrl: src,
                    imagem: ''
                };
                await db.collection('fotos_celulas').doc(id).set(doc, { merge: true });
                return { sucesso: true, foto: doc };
            }
            if (src && String(src).indexOf('data:') === 0) {
                if (String(src).length > 900000) {
                    throw new Error('Foto grande demais para a nuvem. Use outra com menos resolução.');
                }
                const doc = {
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
                await db.collection('fotos_celulas').doc(id).set(doc, { merge: true });
                return { sucesso: true, foto: Object.assign({}, doc, { url: src, imagem: src }) };
            }
            throw new Error('Nenhuma imagem válida para enviar.');
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            console.warn('salvarFotoCelulaNuvem:', ultimoErro);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }

    async function buscarFotosCelulas() {
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
    async function registrarAtividade(tipo, detalhe, usuario) {
        if (!iniciar() || !db) return { sucesso: false };
        try {
            const u = usuario || (typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null) || {};
            const id = 'act-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
            const doc = {
                id: id,
                tipo: tipo || 'outro',
                detalhe: detalhe || '',
                usuarioId: u.id || '',
                usuarioNome: u.nome || '',
                quando: new Date().toISOString()
            };
            await db.collection('atividades').doc(id).set(doc);
            return { sucesso: true };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }

    async function buscarAtividades(limite) {
        if (!iniciar() || !db) return { sucesso: false, lista: [], mensagem: ultimoErro };
        try {
            const snap = await db.collection('atividades').get();
            const lista = [];
            snap.forEach(function (doc) { lista.push(doc.data()); });
            lista.sort(function (a, b) {
                return String(b.quando || '').localeCompare(String(a.quando || ''));
            });
            const n = limite || 200;
            return { sucesso: true, lista: lista.slice(0, n) };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, lista: [], mensagem: ultimoErro };
        }
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
    async function enviarTudoDoAparelho() {
        if (!iniciar()) return { sucesso: false, mensagem: ultimoErro };
        const membros = (typeof lerMembros === 'function') ? lerMembros() : [];
        const rels = (typeof lerRelatoriosCelula === 'function') ? lerRelatoriosCelula() : [];
        const r1 = await sincronizarMembros(membros);
        let okRel = 0;
        for (let i = 0; i < rels.length; i++) {
            const rr = await sincronizarRelatorio(rels[i]);
            if (rr.sucesso) okRel++;
        }
        let okFoto = 0;
        try {
            const fotos = JSON.parse(localStorage.getItem('ibn_fotos') || '[]');
            for (let i = 0; i < fotos.length; i++) {
                const rf = await salvarFotoNuvem(fotos[i]);
                if (rf.sucesso) okFoto++;
            }
        } catch (e) {}
        let okFc = 0;
        try {
            const fcs = JSON.parse(localStorage.getItem('ibn_fotos_celulas') || '[]');
            for (let i = 0; i < fcs.length; i++) {
                const rf = await salvarFotoCelulaNuvem(fcs[i]);
                if (rf.sucesso) okFc++;
            }
        } catch (e) {}
        return {
            sucesso: r1.sucesso,
            mensagem: 'Membros: ' + membros.length + ' · Relatórios: ' + okRel + '/' + rels.length +
                ' · Fotos: ' + okFoto + ' · Fotos célula: ' + okFc,
            membros: membros.length,
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

        // Evita spam: no máximo 1x a cada 3 minutos por membro neste aparelho
        try {
            var chave = 'ibn_sync_sessao_' + String(usuario.id);
            var ultima = parseInt(localStorage.getItem(chave) || '0', 10);
            if (ultima && (Date.now() - ultima) < 3 * 60 * 1000) {
                return { sucesso: true, mensagem: 'Já sincronizado há pouco', pulado: true };
            }
        } catch (e) {}

        var resultados = { membro: false, fotos: 0, fotosCelula: 0, fotosPuxadas: false };

        // 1) PUXA fotos da nuvem ANTES de enviar — o que admin/gestor apagou some deste aparelho
        //    (evita reenviar foto já excluída)
        try {
            await puxarFotosParaLocal();
            await puxarFotosCelulasParaLocal();
            try { await puxarEscalasParaLocal(); } catch (eEsc) {}
            resultados.fotosPuxadas = true;
        } catch (e) {
            console.warn('sync sessão puxar fotos:', e);
        }

        // 2) Membro completo da lista local (tem senha e todos os campos)
        try {
            var completo = usuario;
            if (typeof lerMembros === 'function') {
                var lista = lerMembros() || [];
                var achado = lista.find(function (m) { return String(m.id) === String(usuario.id); });
                if (achado) completo = achado;
            }
            var rm = await sincronizarUmMembro(completo);
            resultados.membro = !!(rm && rm.sucesso);
        } catch (e) {
            console.warn('sync sessão membro:', e);
        }

        // 3) Envia fotos DESTE autor que ainda estão no aparelho (não apagadas na nuvem)
        try {
            var fotos = JSON.parse(localStorage.getItem('ibn_fotos') || '[]');
            for (var i = 0; i < fotos.length; i++) {
                var f = fotos[i];
                if (!f) continue;
                var autorOk = String(f.autorId || '') === String(usuario.id) ||
                    (f.autor && usuario.nome && String(f.autor).toLowerCase() === String(usuario.nome).toLowerCase());
                if (!autorOk) continue;
                var rf = await salvarFotoNuvem(f);
                if (rf && rf.sucesso) resultados.fotos++;
            }
        } catch (e) {}

        try {
            var fcs = JSON.parse(localStorage.getItem('ibn_fotos_celulas') || '[]');
            for (var j = 0; j < fcs.length; j++) {
                var fc = fcs[j];
                if (!fc) continue;
                var okA = String(fc.autorId || '') === String(usuario.id) ||
                    (fc.autor && usuario.nome && String(fc.autor).toLowerCase() === String(usuario.nome).toLowerCase());
                if (!okA) continue;
                var rfc = await salvarFotoCelulaNuvem(fc);
                if (rfc && rfc.sucesso) resultados.fotosCelula++;
            }
        } catch (e) {}

        try {
            localStorage.setItem('ibn_sync_sessao_' + String(usuario.id), String(Date.now()));
        } catch (e) {}

        return {
            sucesso: resultados.membro || resultados.fotos > 0 || resultados.fotosCelula > 0,
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


    return {
        iniciar: iniciar,
        status: status,
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
        puxarPedidosOracaoParaLocal: puxarPedidosOracaoParaLocal
    };
})();
