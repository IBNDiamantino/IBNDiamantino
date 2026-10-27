// ==============================================
// GERENCIAMENTO DE CONTAS — IBN Diamantino
// Modelo unificado: membros, células, ministérios,
// cargos, aprovação e recuperação de senha
// ==============================================

const CHAVE_MEMBROS = 'ibn_membros';
const CHAVE_SESSAO = 'ibn_sessao_atual';
const CHAVE_FOTOS = 'ibn_fotos';
const CHAVE_FOTOS_CELULAS = 'ibn_fotos_celulas';
const CHAVE_ORACOES = 'ibn_pedidos_oracao';
const CHAVE_BLOQUEIOS = 'ibn_bloqueios';
const CHAVE_EXCLUIDOS = 'ibn_membros_excluidos';
const CHAVE_VISITANTES = 'ibn_visitantes';

/** Converte dd/mm/aaaa ou ISO para aaaa-mm-dd (input type=date e exibição) */
function normalizarDataParaISO(str) {
    if (!str) return '';
    const s = String(str).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
        const dd = m[1].padStart(2, '0');
        const mm = m[2].padStart(2, '0');
        return m[3] + '-' + mm + '-' + dd;
    }
    return s;
}

/** Exibe data em pt-BR a partir de ISO, dd/mm/aaaa ou Date */
function formatarDataBR(str) {
    if (!str) return 'Não informado';
    const iso = normalizarDataParaISO(str);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        const p = iso.split('-');
        return p[2] + '/' + p[1] + '/' + p[0];
    }
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('pt-BR');
    return String(str);
}


// ---------- IDENTIDADE DA PESSOA (regra tipo gestão de membros) ----------
// Mesma pessoa se: até 3 primeiros nomes iguais + data de nascimento igual.
// E-mail NÃO define identidade (pode casar e mudar sobrenome / ter outro e-mail).
const PARTICULAS_NOME = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1, del: 1, di: 1 };

function partesNomeSignificativas(nome) {
    const bruto = String(nome || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    const significativos = bruto.filter(function (p) { return !PARTICULAS_NOME[p]; });
    // Usa significativos; se poucos, completa com o bruto
    const base = significativos.length >= 2 ? significativos : bruto;
    return base.slice(0, 3);
}

/** Chave estável: "maria|alice|silva" + nascimento ISO */
function chaveIdentidadePessoa(nome, nascimento) {
    const partes = partesNomeSignificativas(nome);
    const nasc = normalizarDataParaISO(nascimento || '');
    if (partes.length < 2 || !nasc) return '';
    return partes.join('|') + '#' + nasc;
}

function mesmaPessoa(a, b) {
    if (!a || !b) return false;
    const ka = chaveIdentidadePessoa(a.nome, a.nascimento);
    const kb = chaveIdentidadePessoa(b.nome, b.nascimento);
    return !!(ka && kb && ka === kb);
}

/** Busca membro já cadastrado pela regra nome (3 primeiros) + aniversário */
function buscarMesmaPessoa(nome, nascimento, lista) {
    const chave = chaveIdentidadePessoa(nome, nascimento);
    if (!chave) return null;
    const arr = lista || lerMembros();
    return arr.find(function (m) {
        return chaveIdentidadePessoa(m.nome, m.nascimento) === chave;
    }) || null;
}

// ---------- CATÁLOGOS FIXOS ----------
const LISTA_CELULAS_PADRAO = [
    { id: 'somos-igreja', nome: 'Célula Somos a Igreja', dia: 'terca' },
    { id: 'genesis', nome: 'Célula Gênesis', dia: 'terca' },
    { id: 'fonte-agua', nome: 'Célula Fonte de Água Viva', dia: 'terca' },
    { id: 'ebenezer', nome: 'Célula Ebenézer', dia: 'terca' },
    { id: 'shamah', nome: 'Célula Shamah', dia: 'terca' },
    { id: 'morada', nome: 'Célula Morada', dia: 'terca' },
    { id: 'atos2', nome: 'Célula Atos 2', dia: 'terca' },
    { id: 'primeiro-mandamento', nome: 'Célula Primeiro Mandamento', dia: 'terca' },
    { id: 'missao', nome: 'Célula Missão', dia: 'terca' },
    { id: 'adolescentes', nome: 'Célula de Adolescentes', dia: 'sabado' },
    { id: 'jovens', nome: 'Célula de Jovens', dia: 'sabado' }
];

const CHAVE_LISTA_CELULAS = 'ibn_lista_celulas';

/** Lista ativa de células (pode ser editada por gestor/admin) */
var LISTA_CELULAS = LISTA_CELULAS_PADRAO.slice();

function _slugCelula(nome) {
    return String(nome || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || ('celula-' + Date.now());
}

function carregarListaCelulas() {
    var salva = [];
    try { salva = JSON.parse(localStorage.getItem(CHAVE_LISTA_CELULAS) || '[]'); } catch (e) { salva = []; }
    if (!Array.isArray(salva) || !salva.length) {
        LISTA_CELULAS = LISTA_CELULAS_PADRAO.map(function (c) { return Object.assign({}, c); });
        return LISTA_CELULAS;
    }
    // mescla: mantém as salvas; se faltar alguma padrão antiga, não força de volta (gestor pode ter removido)
    LISTA_CELULAS = salva.filter(function (c) { return c && c.id && c.nome; }).map(function (c) {
        return {
            id: String(c.id),
            nome: String(c.nome),
            dia: (c.dia === 'sabado' ? 'sabado' : 'terca'),
            endereco: c.endereco || '',
            horario: c.horario || '',
            localAjustavel: !!c.localAjustavel
        };
    });
    if (!LISTA_CELULAS.length) {
        LISTA_CELULAS = LISTA_CELULAS_PADRAO.map(function (c) { return Object.assign({}, c); });
    }
    return LISTA_CELULAS;
}

function salvarListaCelulas(lista) {
    if (Array.isArray(lista)) LISTA_CELULAS = lista;
    localStorage.setItem(CHAVE_LISTA_CELULAS, JSON.stringify(LISTA_CELULAS));
    // sobe para a nuvem (tenta de novo se o Firebase ainda estiver iniciando)
    function subir() {
        try {
            if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return false;
            firebase.firestore().collection('config').doc('lista_celulas').set({
                itens: LISTA_CELULAS,
                atualizadoEm: new Date().toISOString()
            }, { merge: true }).then(function () {
                try { window.dispatchEvent(new CustomEvent('ibn-lista-celulas-salva')); } catch (e0) {}
            }).catch(function () {});
            return true;
        } catch (e2) { return false; }
    }
    if (!subir()) {
        setTimeout(function () { subir(); }, 1500);
        setTimeout(function () { subir(); }, 4000);
    }
    return { sucesso: true };
}

/** Baixa catálogo de células da nuvem (outros aparelhos veem as alterações) */
async function puxarListaCelulasDaNuvem() {
    try {
        if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return false;
        var snap = await firebase.firestore().collection('config').doc('lista_celulas').get();
        if (!snap.exists) return false;
        var d = snap.data() || {};
        var itens = d.itens || d.lista || [];
        if (!Array.isArray(itens) || !itens.length) return false;
        localStorage.setItem(CHAVE_LISTA_CELULAS, JSON.stringify(itens));
        carregarListaCelulas();
        try { window.dispatchEvent(new CustomEvent('ibn-lista-celulas-atualizada')); } catch (e1) {}
        return true;
    } catch (e) { return false; }
}

function podeGerenciarCatalogoCelulas(u) {
    u = u || (typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null);
    if (!u) return false;
    if (typeof isGestor === 'function' && isGestor(u)) return true;
    if (typeof isAdmin === 'function' && isAdmin(u)) return true;
    var n = String(u.nivel || '').toLowerCase();
    return n === 'gestor' || n === 'admin';
}

/** Cria uma nova célula no catálogo (gestor/admin) */
function adicionarCelulaCatalogo(dados) {
    if (!podeGerenciarCatalogoCelulas()) {
        return { sucesso: false, mensagem: 'Somente gestor ou administrador pode adicionar células.' };
    }
    carregarListaCelulas();
    var nome = String((dados && dados.nome) || '').trim();
    if (!nome) return { sucesso: false, mensagem: 'Informe o nome da célula.' };
    var dia = (dados && dados.dia === 'sabado') ? 'sabado' : 'terca';
    var idBase = _slugCelula(nome);
    var id = idBase;
    var n = 2;
    while (LISTA_CELULAS.some(function (c) { return c.id === id; })) {
        id = idBase + '-' + n;
        n++;
    }
    var reg = {
        id: id,
        nome: nome,
        dia: dia,
        endereco: String((dados && dados.endereco) || '').trim(),
        horario: String((dados && dados.horario) || (dia === 'sabado' ? 'Sábado' : 'Terça 20h')).trim(),
        localAjustavel: !!(dados && dados.localAjustavel) || dia === 'sabado'
    };
    LISTA_CELULAS.push(reg);
    LISTA_CELULAS.sort(function (a, b) {
        if (a.dia !== b.dia) return a.dia === 'terca' ? -1 : 1;
        return String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    });
    salvarListaCelulas(LISTA_CELULAS);
    return { sucesso: true, celula: reg, mensagem: 'Célula adicionada.' };
}

/** Atualiza nome/dia/endereço de uma célula existente */
function editarCelulaCatalogo(id, dados) {
    if (!podeGerenciarCatalogoCelulas()) {
        return { sucesso: false, mensagem: 'Somente gestor ou administrador pode editar células.' };
    }
    carregarListaCelulas();
    var ix = LISTA_CELULAS.findIndex(function (c) { return c.id === id; });
    if (ix < 0) return { sucesso: false, mensagem: 'Célula não encontrada.' };
    var c = LISTA_CELULAS[ix];
    if (dados && dados.nome) c.nome = String(dados.nome).trim();
    if (dados && (dados.dia === 'terca' || dados.dia === 'sabado')) c.dia = dados.dia;
    if (dados && dados.endereco != null) c.endereco = String(dados.endereco).trim();
    if (dados && dados.horario != null) c.horario = String(dados.horario).trim();
    if (dados && typeof dados.localAjustavel === 'boolean') c.localAjustavel = dados.localAjustavel;
    LISTA_CELULAS[ix] = c;
    salvarListaCelulas(LISTA_CELULAS);
    return { sucesso: true, celula: c, mensagem: 'Célula atualizada.' };
}

/** Remove célula do catálogo (não apaga membros da igreja) */
function removerCelulaCatalogo(id) {
    if (!podeGerenciarCatalogoCelulas()) {
        return { sucesso: false, mensagem: 'Somente gestor ou administrador pode remover células.' };
    }
    carregarListaCelulas();
    var antes = LISTA_CELULAS.length;
    LISTA_CELULAS = LISTA_CELULAS.filter(function (c) { return c.id !== id; });
    if (LISTA_CELULAS.length === antes) return { sucesso: false, mensagem: 'Célula não encontrada.' };
    salvarListaCelulas(LISTA_CELULAS);
    return { sucesso: true, mensagem: 'Célula removida do catálogo.' };
}

// carrega lista salva assim que o script sobe
try { carregarListaCelulas(); } catch (eLoadCel) {}

const LISTA_MINISTERIOS = [
    'Atmosfera', 'Acolhimento', 'Mulheres', 'Homens', 'Intercessão',
    'Evangelismo', 'Dança', 'Empreendedorismo', 'Batismo', 'Zeladoria',
    'Projetos Sociais', 'Casais', 'Jovens', 'Adolescentes', 'Louvor',
    'Mídias Sociais', 'Infantil', 'Artes', 'Ensino', 'Cantina', 'Projeto Kids'
];

const LISTA_CARGOS = [
    'Membro(a)',
    'Líder de Célula',
    'Líder de Ministério',
    'Líder em treinamento',
    'Discipulador(a)',
    'Pastor(a)',
    'Missionário(a)',
    'Voluntário(a)',
    'Outro'
];

const CHAVE_ULTIMOS_LOGINS = 'ibn_ultimos_logins';

/** Guarda até 3 últimos identificadores de login neste aparelho */
function registrarUltimoLogin(identificador) {
    const id = String(identificador || '').trim();
    if (!id) return;
    let lista = [];
    try { lista = JSON.parse(localStorage.getItem(CHAVE_ULTIMOS_LOGINS) || '[]'); } catch (e) { lista = []; }
    lista = lista.filter(function (x) { return String(x).toLowerCase() !== id.toLowerCase(); });
    lista.unshift(id);
    lista = lista.slice(0, 3);
    localStorage.setItem(CHAVE_ULTIMOS_LOGINS, JSON.stringify(lista));
}

function lerUltimosLogins() {
    try { return JSON.parse(localStorage.getItem(CHAVE_ULTIMOS_LOGINS) || '[]'); }
    catch (e) { return []; }
}


const PERGUNTAS_SEGURANCA = [
    'Nome da mãe (primeiro nome)',
    'Cidade onde nasceu',
    'Nome do primeiro animal de estimação',
    'Escola onde estudou no ensino fundamental',
    'Cor favorita na infância'
];

const CONTAS_MESTRAS = [
    {
        id: 'gestor-master',
        nome: 'Gestor Master',
        email: 'gestor@ibndiamantino.com.br',
        telefone: '',
        senha: 'IBN-Gestor-2026!',
        nivel: 'gestor',
        status: 'aprovado',
        celulas: [],
        ministerios: [],
        cargo: 'Gestor',
        funcoes: ['master']
    },
    {
        id: 'admin-master',
        nome: 'Admin Master',
        email: 'admin@ibndiamantino.com.br',
        telefone: '',
        senha: 'IBN-Admin-2026!',
        nivel: 'admin',
        status: 'aprovado',
        celulas: [],
        ministerios: [],
        cargo: 'Administrador',
        funcoes: ['master']
    }
];

function salvarMembros(lista) {
    // NÃO carimba todos: isso fazia aparelho antigo “ganhar” e rebaixar admin/gestor na nuvem.
    // Quem altera um membro deve chamar marcarMembroAtualizado(m) antes.
    var limpa = (lista || []).filter(function (m) {
        if (!m) return false;
        try { if (isContaSistema(m)) return false; } catch (e) {}
        try { if (typeof membroFoiExcluido === 'function' && membroFoiExcluido(m)) return false; } catch (e) {}
        return true;
    });
    localStorage.setItem(CHAVE_MEMBROS, JSON.stringify(limpa));
    try { if (typeof atualizarSessaoDoCadastro === 'function') atualizarSessaoDoCadastro(); } catch (e) {}
    // Cópia na nuvem (se configurada) — não bloqueia o uso local
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.sincronizarMembros) {
            IBNNuvem.sincronizarMembros(limpa).then(function (r) {
                if (r && !r.sucesso) {
                    console.warn('Nuvem (membros):', r.mensagem || r);
                    if (typeof avisarFalhaNuvem === 'function') {
                        avisarFalhaNuvem('Cadastro de membros', r.mensagem || 'Falha ao sincronizar');
                    }
                }
            }).catch(function (e) {
                console.warn('Nuvem (membros):', e);
                if (typeof avisarFalhaNuvem === 'function') {
                    avisarFalhaNuvem('Cadastro de membros', (e && e.message) || String(e));
                }
            });
        }
    } catch (e) { /* silencioso */ }
}

/** Garante um membro específico na nuvem (cadastro / edição). Retorna Promise com { sucesso, mensagem }.
 *  opcoes.force = true → grava mesmo se houver versão com data igual/maior (cadastro novo / aprovação). */
function enviarMembroParaNuvem(membro, opcoes) {
    try {
        if (typeof IBNNuvem === 'undefined' || !IBNNuvem.sincronizarUmMembro || !membro) {
            return Promise.resolve({ sucesso: false, mensagem: 'Nuvem não disponível neste aparelho', semNuvem: true });
        }
        if (typeof marcarMembroAtualizado === 'function') marcarMembroAtualizado(membro);
        return IBNNuvem.sincronizarUmMembro(membro, opcoes || {}).then(function (r) {
            if (r && !r.sucesso) {
                console.warn('Nuvem (1 membro):', r.mensagem || r);
                if (typeof avisarFalhaNuvem === 'function') {
                    avisarFalhaNuvem('Cadastro do membro', r.mensagem || 'Não sincronizou');
                }
                return { sucesso: false, mensagem: (r && r.mensagem) || 'Não sincronizou com a nuvem' };
            }
            if (r && r.ignorado) {
                return { sucesso: true, mensagem: 'Nuvem já tinha versão mais recente', ignorado: true };
            }
            return { sucesso: true, mensagem: 'Enviado para a nuvem' };
        }).catch(function (e) {
            console.warn('Nuvem (1 membro):', e);
            if (typeof avisarFalhaNuvem === 'function') {
                avisarFalhaNuvem('Cadastro do membro', (e && e.message) || String(e));
            }
            return { sucesso: false, mensagem: (e && e.message) || String(e) };
        });
    } catch (e) {
        return Promise.resolve({ sucesso: false, mensagem: (e && e.message) || String(e) });
    }
}

/** Marca que este membro ainda precisa subir para a nuvem (celular do membro). */
function marcarPendenteNuvem(membroId, pendente) {
    try {
        if (pendente) {
            localStorage.setItem('ibn_pendente_nuvem_id', String(membroId));
            localStorage.setItem('ibn_pendente_nuvem_em', new Date().toISOString());
        } else {
            localStorage.removeItem('ibn_pendente_nuvem_id');
            localStorage.removeItem('ibn_pendente_nuvem_em');
            if (membroId !== undefined && membroId !== null) {
                localStorage.removeItem('ibn_sync_sessao_' + String(membroId));
            }
        }
    } catch (e) {}
}

function temPendenteNuvem(membroId) {
    try {
        var id = localStorage.getItem('ibn_pendente_nuvem_id');
        if (!id) return false;
        if (membroId === undefined || membroId === null) return true;
        return String(id) === String(membroId);
    } catch (e) { return false; }
}

/**
 * Garante envio do cadastro do MEMBRO para a nuvem (force + várias tentativas).
 * Essencial no celular de quem se cadastrou — sem isso a gestão não vê o pendente.
 */
function garantirCadastroNaNuvem(membro, opcoes) {
    opcoes = opcoes || {};
    var tentativas = opcoes.tentativas != null ? opcoes.tentativas : 5;
    var intervalo = opcoes.intervaloMs != null ? opcoes.intervaloMs : 2000;
    var onProgress = opcoes.onProgress || null;

    if (!membro || membro.id === undefined || membro.id === null) {
        return Promise.resolve({ sucesso: false, mensagem: 'Membro inválido' });
    }

    marcarPendenteNuvem(membro.id, true);

    function umaTentativa(n) {
        if (typeof onProgress === 'function') {
            try { onProgress(n, tentativas); } catch (eP) {}
        }
        return enviarMembroParaNuvem(membro, { force: true }).then(function (r) {
            if (r && r.sucesso && !r.semNuvem) {
                marcarPendenteNuvem(membro.id, false);
                return { sucesso: true, tentativa: n, mensagem: r.mensagem || 'Enviado para a nuvem' };
            }
            // semNuvem: Firebase não configurado neste build — não adianta insistir
            if (r && r.semNuvem) {
                return { sucesso: false, semNuvem: true, mensagem: r.mensagem || 'Nuvem não configurada', tentativa: n };
            }
            if (n >= tentativas) {
                return {
                    sucesso: false,
                    mensagem: (r && r.mensagem) || 'Não foi possível enviar após várias tentativas',
                    tentativa: n
                };
            }
            return new Promise(function (resolve) {
                setTimeout(function () {
                    resolve(umaTentativa(n + 1));
                }, intervalo);
            });
        }).catch(function (e) {
            if (n >= tentativas) {
                return { sucesso: false, mensagem: (e && e.message) || String(e), tentativa: n };
            }
            return new Promise(function (resolve) {
                setTimeout(function () {
                    resolve(umaTentativa(n + 1));
                }, intervalo);
            });
        });
    }

    return umaTentativa(1);
}

function lerBloqueios() {
    try { return JSON.parse(localStorage.getItem(CHAVE_BLOQUEIOS) || '[]'); } catch (e) { return []; }
}
function salvarBloqueios(lista) {
    localStorage.setItem(CHAVE_BLOQUEIOS, JSON.stringify(lista || []));
}

/** Normaliza e-mail / telefone / nome para bloqueio */
function chaveBloqueioEmail(email) { return String(email || '').toLowerCase().trim(); }
function chaveBloqueioTel(tel) { return String(tel || '').replace(/\D/g, ''); }
function chaveBloqueioNome(nome) { return String(nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim(); }

function estaBloqueadoCadastro(dados) {
    const lista = lerBloqueios();
    const em = chaveBloqueioEmail(dados.email);
    const tel = chaveBloqueioTel(dados.telefone);
    const nome = chaveBloqueioNome(dados.nome);
    for (let i = 0; i < lista.length; i++) {
        const b = lista[i];
        if (em && b.email && b.email === em) return { bloqueado: true, motivo: 'Este e-mail está bloqueado para novos cadastros.' };
        if (tel && b.telefone && b.telefone === tel) return { bloqueado: true, motivo: 'Este telefone está bloqueado para novos cadastros.' };
        if (nome && b.nome && b.nome === nome) return { bloqueado: true, motivo: 'Este nome está bloqueado para novos cadastros.' };
    }
    return { bloqueado: false };
}

/** Bloqueia nome e/ou e-mail e/ou telefone (gestor/admin) */
function bloquearCadastro(dados) {
    const u = getUsuarioLogado();
    if (!u || !(isGestor(u) || isAdmin(u))) {
        return { sucesso: false, mensagem: 'Somente gestor ou admin podem bloquear.' };
    }
    const item = {
        id: 'bloq-' + Date.now(),
        nome: chaveBloqueioNome(dados.nome),
        email: chaveBloqueioEmail(dados.email),
        telefone: chaveBloqueioTel(dados.telefone),
        motivo: (dados.motivo || '').trim(),
        porId: u.id,
        porNome: u.nome,
        em: new Date().toISOString()
    };
    if (!item.nome && !item.email && !item.telefone) {
        return { sucesso: false, mensagem: 'Informe ao menos nome, e-mail ou telefone para bloquear.' };
    }
    const lista = lerBloqueios();
    lista.push(item);
    salvarBloqueios(lista);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.registrarAtividade) {
            IBNNuvem.registrarAtividade('bloquear_cadastro', 'Bloqueou: ' + (item.nome || item.email || item.telefone), u);
        }
    } catch (e) {}
    return { sucesso: true, bloqueio: item };
}

function desbloquearCadastro(bloqueioId) {
    const u = getUsuarioLogado();
    if (!u || !(isGestor(u) || isAdmin(u))) return { sucesso: false, mensagem: 'Sem permissão.' };
    const lista = lerBloqueios().filter(b => String(b.id) !== String(bloqueioId));
    salvarBloqueios(lista);
    return { sucesso: true };
}

/**
 * Remove membro sem deixar vestígios locais (e tenta nuvem).
 * Permite novo cadastro com mesmo nome, e-mail ou telefone.
 */

/** Membros removidos de vez — não voltam da nuvem nem de outro aparelho */
function lerExcluidos() {
    try { return JSON.parse(localStorage.getItem(CHAVE_EXCLUIDOS) || '[]'); } catch (e) { return []; }
}
function salvarExcluidos(lista) {
    localStorage.setItem(CHAVE_EXCLUIDOS, JSON.stringify(lista || []));
}
function registrarExclusaoMembro(m) {
    if (!m) return;
    const lista = lerExcluidos();
    const item = {
        id: String(m.id),
        chave: chaveIdentidadePessoa(m.nome, m.nascimento || m.dataNascimento) || '',
        email: String(m.email || '').toLowerCase().trim(),
        telefone: String(m.telefone || '').replace(/\D/g, ''),
        nome: m.nome || '',
        em: new Date().toISOString()
    };
    // evita duplicar
    const nova = lista.filter(function (x) {
        return String(x.id) !== item.id &&
            !(item.chave && x.chave === item.chave) &&
            !(item.email && x.email === item.email);
    });
    nova.push(item);
    salvarExcluidos(nova);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.sincronizarExcluidos) {
            IBNNuvem.sincronizarExcluidos(nova);
        }
    } catch (e) {}
}
function membroFoiExcluido(m) {
    if (!m) return false;
    const lista = lerExcluidos();
    if (!lista.length) return false;
    const id = String(m.id);
    const email = String(m.email || '').toLowerCase().trim();
    const tel = String(m.telefone || '').replace(/\D/g, '');
    const chave = chaveIdentidadePessoa(m.nome, m.nascimento || m.dataNascimento) || '';
    return lista.some(function (x) {
        if (x.id && String(x.id) === id) return true;
        if (chave && x.chave && x.chave === chave) return true;
        if (email && x.email && x.email === email) return true;
        if (tel && x.telefone && (x.telefone === tel || x.telefone.endsWith(tel.slice(-8)) || tel.endsWith(String(x.telefone).slice(-8)))) return true;
        return false;
    });
}

function excluirMembroDefinitivo(membroId) {
    const u = getUsuarioLogado();
    // Somente gestor — admin (secretaria) não remove cadastro definitivo
    if (!u || !isGestor(u)) {
        return { sucesso: false, mensagem: 'Somente o gestor pode remover um membro definitivamente.' };
    }
    const lista = lerMembros();
    const m = lista.find(x => String(x.id) === String(membroId));
    if (!m) return { sucesso: false, mensagem: 'Membro não encontrado.' };
    // 1) marca exclusão local + nuvem (antes de qualquer sync de membros)
    registrarExclusaoMembro(m);
    const nova = lista.filter(x => String(x.id) !== String(membroId));
    salvarMembros(nova);
    try {
        if (typeof IBNNuvem !== 'undefined') {
            // apaga documento na nuvem
            if (IBNNuvem.removerMembroNuvem) {
                IBNNuvem.removerMembroNuvem(membroId).catch(function () {});
            }
            // reenvia lista de excluídos para a nuvem (evita "ressuscitar" em outro aparelho)
            if (IBNNuvem.sincronizarExcluidos) {
                IBNNuvem.sincronizarExcluidos(lerExcluidos()).catch(function () {});
            }
            if (IBNNuvem.registrarAtividade) {
                IBNNuvem.registrarAtividade('excluir_membro', 'Removeu definitivamente: ' + (m.nome || membroId), u);
            }
        }
    } catch (e) {}
    return { sucesso: true, removido: m };
}


/** Cadastro de visitantes (acolhimento) — separado de membros */
const ETAPAS_VISITANTE = [
    { id: 'aceitou_reconciliou', label: 'Aceitou ou reconciliou' },
    { id: 'cafe_acolhimento', label: 'Passou pelo café de acolhimento' },
    { id: 'passou_impacto', label: 'Passou pelo Impacto' },
    { id: 'batizado', label: 'Foi batizado' },
    { id: 'virou_membro', label: 'Virou membro da igreja' }
];

function lerVisitantes() {
    try { return JSON.parse(localStorage.getItem(CHAVE_VISITANTES) || '[]'); } catch (e) { return []; }
}
function salvarVisitantes(lista) {
    localStorage.setItem(CHAVE_VISITANTES, JSON.stringify(lista || []));
}

function podeGerenciarVisitantes(u) {
    u = u || getUsuarioLogado();
    if (!u) return false;
    if (isAdmin(u) || isGestor(u)) return true;
    // líder / participante do ministério Acolhimento
    const mins = Array.isArray(u.ministerios) ? u.ministerios : [];
    const lidera = Array.isArray(u.lideraMinisterios) ? u.lideraMinisterios : [];
    const all = mins.concat(lidera).concat([u.lideraMinisterio || '']);
    return all.some(function (m) {
        return String(m || '').toLowerCase().indexOf('acolh') !== -1;
    });
}

function salvarVisitante(dados) {
    if (!podeGerenciarVisitantes()) {
        return { sucesso: false, mensagem: 'Sem permissão. Apenas gestão ou ministério de Acolhimento.' };
    }
    const nome = String(dados.nome || '').trim();
    if (nome.length < 2) return { sucesso: false, mensagem: 'Informe o nome do visitante.' };
    const lista = lerVisitantes();
    let v;
    if (dados.id) {
        const idx = lista.findIndex(x => String(x.id) === String(dados.id));
        if (idx < 0) return { sucesso: false, mensagem: 'Visitante não encontrado.' };
        v = Object.assign({}, lista[idx], {
            nome: nome,
            telefone: String(dados.telefone || '').trim(),
            email: String(dados.email || '').trim().toLowerCase(),
            dataVisita: dados.dataVisita || lista[idx].dataVisita,
            eventos: Array.isArray(dados.eventos) ? dados.eventos : (lista[idx].eventos || []),
            etapas: dados.etapas && typeof dados.etapas === 'object' ? dados.etapas : (lista[idx].etapas || {}),
            observacoes: String(dados.observacoes || lista[idx].observacoes || '').trim(),
            atualizadoEm: new Date().toISOString()
        });
        lista[idx] = v;
    } else {
        v = {
            id: 'vis-' + Date.now(),
            nome: nome,
            telefone: String(dados.telefone || '').trim(),
            email: String(dados.email || '').trim().toLowerCase(),
            dataVisita: dados.dataVisita || new Date().toISOString().slice(0, 10),
            eventos: Array.isArray(dados.eventos) ? dados.eventos : [],
            etapas: dados.etapas && typeof dados.etapas === 'object' ? dados.etapas : {},
            observacoes: String(dados.observacoes || '').trim(),
            criadoEm: new Date().toISOString(),
            atualizadoEm: new Date().toISOString(),
            criadoPor: (getUsuarioLogado() || {}).nome || ''
        };
        lista.unshift(v);
    }
    salvarVisitantes(lista);
    try {
        if (typeof IBNNuvem !== 'undefined') {
            if (IBNNuvem.sincronizarVisitante) IBNNuvem.sincronizarVisitante(v);
            if (IBNNuvem.registrarAtividade) IBNNuvem.registrarAtividade('visitante', (dados.id ? 'Atualizou' : 'Cadastrou') + ' visitante ' + nome, getUsuarioLogado());
        }
    } catch (e) {}
    return { sucesso: true, visitante: v };
}

function alternarEtapaVisitante(id, etapaId) {
    if (!podeGerenciarVisitantes()) return { sucesso: false, mensagem: 'Sem permissão.' };
    const lista = lerVisitantes();
    const idx = lista.findIndex(x => String(x.id) === String(id));
    if (idx < 0) return { sucesso: false, mensagem: 'Não encontrado.' };
    if (!lista[idx].etapas) lista[idx].etapas = {};
    lista[idx].etapas[etapaId] = !lista[idx].etapas[etapaId];
    lista[idx].atualizadoEm = new Date().toISOString();
    salvarVisitantes(lista);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.sincronizarVisitante) IBNNuvem.sincronizarVisitante(lista[idx]);
    } catch (e) {}
    return { sucesso: true, visitante: lista[idx] };
}

function removerVisitante(id) {
    if (!podeGerenciarVisitantes()) return { sucesso: false, mensagem: 'Sem permissão.' };
    const lista = lerVisitantes().filter(x => String(x.id) !== String(id));
    salvarVisitantes(lista);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.removerVisitanteNuvem) IBNNuvem.removerVisitanteNuvem(id);
    } catch (e) {}
    return { sucesso: true };
}

function progressoVisitante(v) {
    const etapas = (v && v.etapas) || {};
    let ok = 0;
    ETAPAS_VISITANTE.forEach(function (e) { if (etapas[e.id]) ok++; });
    return { feitos: ok, total: ETAPAS_VISITANTE.length };
}

function lerMembros() {
    try {
        const dados = localStorage.getItem(CHAVE_MEMBROS);
        let lista = dados ? JSON.parse(dados) : [];
        if (!Array.isArray(lista)) lista = [];
        // Contas de sistema nunca devem aparecer como membros da igreja
        const limpa = lista.filter(function (m) {
            try { return !isContaSistema(m); } catch (e) { return true; }
        });
        // Também remove quem já foi excluído de forma definitiva
        const semExcluidos = limpa.filter(function (m) {
            try { return typeof membroFoiExcluido !== 'function' || !membroFoiExcluido(m); } catch (e) { return true; }
        });
        if (semExcluidos.length !== lista.length) {
            try { localStorage.setItem(CHAVE_MEMBROS, JSON.stringify(semExcluidos)); } catch (e) {}
        }
        return semExcluidos;
    } catch {
        return [];
    }
}

function validarCelulas(celulas) {
    if (!Array.isArray(celulas) || celulas.length === 0) {
        return { lista: [] };
    }
    if (celulas.length > 2) {
        return { erro: 'Você pode participar de no máximo 2 células (1 na terça e 1 no sábado).' };
    }
    const dias = celulas.map(c => c.dia || (LISTA_CELULAS.find(x => x.id === c.id) || {}).dia);
    const tercas = dias.filter(d => d === 'terca').length;
    const sabados = dias.filter(d => d === 'sabado').length;
    if (tercas > 1) return { erro: 'Só é permitido 1 célula de terça-feira.' };
    if (sabados > 1) return { erro: 'Só é permitido 1 célula de sábado.' };

    const lista = celulas.map(c => {
        const ref = LISTA_CELULAS.find(x => x.id === c.id) || c;
        return { id: ref.id, nome: ref.nome, dia: ref.dia };
    });
    return { lista };
}

function cadastrarMembro(dados) {
    const lista = lerMembros();
    const emailNorm = (dados.email || '').toLowerCase().trim();
    const telNorm = (dados.telefone || '').replace(/\D/g, '');

    // Bloqueios feitos pelo gestor/admin
    const bloq = (typeof estaBloqueadoCadastro === 'function') ? estaBloqueadoCadastro(dados) : { bloqueado: false };
    if (bloq.bloqueado) {
        return { sucesso: false, mensagem: bloq.motivo || 'Cadastro bloqueado pela igreja.' };
    }

    // Mesma pessoa: 3 primeiros nomes + data de nascimento (e-mail não define identidade)
    // Bloqueia se foi removido definitivamente pela gestão
    const fantasma = { nome: dados.nome, nascimento: dados.nascimento, email: dados.email, telefone: dados.telefone, id: '' };
    if (membroFoiExcluido(fantasma)) {
        return {
            sucesso: false,
            mensagem: 'Este cadastro foi removido pela gestão. Fale com a secretaria para liberar de novo.'
        };
    }

    const jaPessoa = buscarMesmaPessoa(dados.nome, dados.nascimento, lista);
    if (jaPessoa) {
        const emailMasc = (jaPessoa.email || '').replace(/(.{2}).+(@.+)/, '$1***$2');
        return {
            sucesso: false,
            mensagem: 'Esta pessoa já possui cadastro (mesmo nome e data de nascimento)' +
                (emailMasc ? '. Tente login ou recuperar senha com o e-mail ' + emailMasc : '. Use login ou recuperar senha.') +
                ' Se casou e mudou o sobrenome, é o mesmo cadastro — não crie outro.'
        };
    }
    if (lista.find(m => (m.email || '').toLowerCase() === emailNorm)) {
        return { sucesso: false, mensagem: 'Este e-mail já está cadastrado!' };
    }
    if (telNorm && lista.find(m => (m.telefone || '').replace(/\D/g, '') === telNorm)) {
        return { sucesso: false, mensagem: 'Este telefone já está cadastrado!' };
    }

    const celulas = validarCelulas(dados.celulas || []);
    if (celulas.erro) {
        return { sucesso: false, mensagem: celulas.erro };
    }

    const novo = {
        id: Date.now(),
        nome: (dados.nome || '').trim(),
        email: emailNorm,
        telefone: (dados.telefone || '').trim(),
        senha: dados.senha,
        sexo: dados.sexo || '',
        nascimento: normalizarDataParaISO(dados.nascimento || ''),
        estadoCivil: dados.estadoCivil || '',
        endereco: dados.endereco || '',
        municipio: (dados.municipio || '').trim(),
        uf: (dados.uf || 'MT').trim().toUpperCase(),
        origem: dados.origem || '',
        batismo: dados.batismo || dados.batizado || '',
        batizado: (dados.batizado === true || dados.batismo === 'sim' || dados.batizado === 'sim'),
        dataBatismo: normalizarDataParaISO(dados.dataBatismo || ''),
        jaMembro: !!dados.jaMembro,
        celulas: celulas.lista,
        ministerios: Array.isArray(dados.ministerios) ? dados.ministerios : [],
        cargo: dados.cargo || 'Membro',
        funcaoEspecifica: (dados.funcaoEspecifica || '').trim(),
        lideraCelulaId: dados.lideraCelulaId || '',
        lideraMinisterio: dados.lideraMinisterio || '',
        perguntaSeguranca: dados.perguntaSeguranca || '',
        respostaSeguranca: (dados.respostaSeguranca || '').toLowerCase().trim(),
        status: dados.jaMembro ? 'pendente' : 'aprovado',
        nivel: 'membro',
        funcoes: [],
        deveTrocarSenha: false,
        dataCadastro: new Date().toISOString(),
        inscricoes: []
    };

    if (novo.cargo === 'Líder de Ministério' || novo.cargo === 'Líder de Célula' ||
        novo.cargo === 'Líder em treinamento' || novo.cargo === 'Discipulador') {
        novo.status = 'pendente';
    }

    // Carimba data antes do primeiro save local (evita ts=0 na mescla da nuvem)
    if (typeof marcarMembroAtualizado === 'function') {
        marcarMembroAtualizado(novo);
    } else {
        novo.atualizadoEm = new Date().toISOString();
        if (!novo.criadoEm) novo.criadoEm = novo.atualizadoEm;
    }
    if (!novo.criadoEm) novo.criadoEm = novo.atualizadoEm || novo.dataCadastro;

    lista.push(novo);
    salvarMembros(lista);
    iniciarSessao(novo);
    marcarPendenteNuvem(novo.id, true);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.registrarAtividade) {
            IBNNuvem.registrarAtividade('cadastro', 'Novo cadastro no site: ' + (novo.nome || ''), novo);
        }
    } catch (e) {}
    // NÃO dispara só fire-and-forget: a página deve chamar garantirCadastroNaNuvem
    // e aguardar. Ainda assim inicia um envio imediato em paralelo.
    try {
        garantirCadastroNaNuvem(novo, { tentativas: 5, intervaloMs: 2500 });
    } catch (e2) {
        try { enviarMembroParaNuvem(novo, { force: true }); } catch (e3) {}
    }
    return { sucesso: true, mensagem: 'Cadastro realizado!', membro: novo, aguardarNuvem: true };
}

function iniciarSessao(membro) {
    // Não guarda senha/resposta de segurança na sessão
    const { senha, respostaSeguranca, ...dadosPublicos } = membro;
    const json = JSON.stringify(dadosPublicos);
    // Chave oficial + chave usada na versão "map" (compatibilidade total)
    localStorage.setItem(CHAVE_SESSAO, json);
    localStorage.setItem('usuarioLogado', json);
    // Sincroniza dados e fotos deste membro com a nuvem (silencioso)
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.agendarSyncSessao) {
            IBNNuvem.agendarSyncSessao(membro, 800);
            try {
                if (IBNNuvem.sincronizarTudoDaNuvem) setTimeout(function(){ IBNNuvem.sincronizarTudoDaNuvem('login'); }, 1000);
                else if (IBNNuvem.puxarMembrosParaLocal) setTimeout(function(){ IBNNuvem.puxarMembrosParaLocal(); }, 1000);
            } catch (eLoginSync) {}
        }
    } catch (e) {}
}

function getUsuarioLogado() {
    try {
        // Tenta chave oficial primeiro
        let dados = localStorage.getItem(CHAVE_SESSAO);
        if (dados) return JSON.parse(dados);
        // Fallback: chave da versão map (login antigo / outras páginas)
        dados = localStorage.getItem('usuarioLogado');
        if (dados) {
            const usuario = JSON.parse(dados);
            // Sincroniza para a chave oficial
            localStorage.setItem(CHAVE_SESSAO, dados);
            return usuario;
        }
        return null;
    } catch {
        return null;
    }
}

/** Atualiza a sessão logada com o cadastro mais recente (após nuvem / gestão). */
function atualizarSessaoDoCadastro() {
    try {
        var sess = getUsuarioLogado();
        if (!sess || !sess.id) return null;
        // Contas mestras não vêm da lista de membros
        if (typeof isContaSistema === 'function' && isContaSistema(sess)) return sess;
        var lista = lerMembros();
        var m = lista.find(function (x) { return String(x.id) === String(sess.id); });
        if (!m) return sess;
        var { senha, respostaSeguranca, ...pub } = m;
        // Mantém campos de sessão que não estão no cadastro
        var misturado = Object.assign({}, sess, pub);
        delete misturado.senha;
        delete misturado.respostaSeguranca;
        var json = JSON.stringify(misturado);
        localStorage.setItem(CHAVE_SESSAO, json);
        localStorage.setItem('usuarioLogado', json);
        return misturado;
    } catch (e) {
        return null;
    }
}

function marcarMembroAtualizado(m) {
    if (!m) return m;
    m.atualizadoEm = new Date().toISOString();
    try {
        var u = (typeof getUsuarioLogado === 'function') ? getUsuarioLogado() : null;
        if (u && (u.nome || u.id)) {
            m.atualizadoPorId = u.id || '';
            m.atualizadoPorNome = u.nome || u.email || '';
        }
    } catch (e) {}
    return m;
}

/** Alerta amigável quando algo não sobe para a nuvem */
function avisarFalhaNuvem(tipo, detalhe) {
    var msg = String(tipo || 'Dados') + ' não carregou na nuvem.';
    if (detalhe) msg += '\n' + detalhe;
    msg += '\n\nNo celular/outro aparelho pode continuar a versão antiga.\nContate a secretaria se repetir.';
    try {
        localStorage.setItem('ibn_ultima_falha_nuvem', JSON.stringify({
            tipo: tipo, detalhe: detalhe || '', quando: new Date().toISOString()
        }));
    } catch (e) {}
    try { alert(msg); } catch (e) { console.warn(msg); }
}


function normalizarTelefoneBR(tel) {
    let d = String(tel || '').replace(/\D/g, '');
    if (d.indexOf('55') === 0 && d.length >= 12) d = d.slice(2);
    // remove zero inicial de operadora antiga
    if (d.charAt(0) === '0') d = d.slice(1);
    return d;
}

/** Compara telefones com tolerância (DDI, 9º dígito, formatação) */
function telefonesIguais(a, b) {
    const x = normalizarTelefoneBR(a);
    const y = normalizarTelefoneBR(b);
    if (!x || !y) return false;
    if (x === y) return true;
    // últimos 8 dígitos (fix sem DDD) ou 10/11
    const x8 = x.slice(-8);
    const y8 = y.slice(-8);
    if (x8.length === 8 && x8 === y8) return true;
    // um tem 9º dígito a mais no meio (celular BR)
    if (x.length >= 10 && y.length >= 10) {
        const xd = x.slice(0, 2) + x.slice(-8);
        const yd = y.slice(0, 2) + y.slice(-8);
        if (xd === yd) return true;
    }
    return false;
}

function fazerLogin(identificador, senha) {
    const id = (identificador || '').trim().toLowerCase();
    const tel = id.replace(/\D/g, '');

    const master = CONTAS_MESTRAS.find(c =>
        c.email.toLowerCase() === id && c.senha === senha
    );
    if (master) {
        iniciarSessao(master);
        try { registrarUltimoLogin(identificador); } catch (e) {}
        return { sucesso: true, usuario: master };
    }

    const lista = lerMembros();
    const senhaTrim = String(senha || '').trim();
    // 1) tenta match completo (identificador + senha)
    let membro = lista.find(m => {
        const emailOk = (m.email || '').toLowerCase() === id;
        const telOk = tel && telefonesIguais(m.telefone, tel);
        return (emailOk || telOk) && String(m.senha || '').trim() === senhaTrim;
    });

    // 2) se senha confere mas telefone digitado diferente, avisa
    if (!membro && senhaTrim) {
        const porSenha = lista.filter(m => String(m.senha || '').trim() === senhaTrim);
        if (porSenha.length === 1 && tel) {
            // senha existe em um único cadastro — telefone que o usuário digitou não bate
            const m = porSenha[0];
            const telCad = normalizarTelefoneBR(m.telefone);
            return {
                sucesso: false,
                mensagem: 'Senha confere, mas o telefone não é o do cadastro. Use o telefone ' +
                    (telCad || 'cadastrado') + ' ou o e-mail: ' + (m.email || '—')
            };
        }
    }

    if (!membro) {
        return { sucesso: false, mensagem: 'E-mail/telefone ou senha incorretos.' };
    }

    iniciarSessao(membro);
    try { registrarUltimoLogin(identificador); } catch (e) {}
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.registrarAtividade) {
            IBNNuvem.registrarAtividade('login', 'Login no site', membro);
        }
    } catch (e) {}
    return { sucesso: true, usuario: membro };
}

function exigirLogin() {
    if (!getUsuarioLogado()) {
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

function sair() {
    localStorage.removeItem(CHAVE_SESSAO);
    localStorage.removeItem('usuarioLogado');
    window.location.href = 'login.html';
}

/**
 * Hierarquia de governo do site (sem mudar o visual):
 * - gestor  = autoridade máxima (pastor/direção). Última palavra. Pode tudo, inclusive nomear/remover admin (secretaria).
 * - admin   = secretaria. Aprova membros, lideranças de célula/ministério, exporta relatórios (com o gestor).
 * - lider_* = só a própria célula/ministério.
 * - membro  = área do membro, fotos, etc.
 */
function isGestor(u) {
    u = u || getUsuarioLogado();
    return !!(u && u.nivel === 'gestor');
}

/** Só a conta Gestor Master (sistema) — nomeia/transfere gestores */
function isGestorMaster(u) {
    u = u || getUsuarioLogado();
    if (!u) return false;
    var id = String(u.id || '').toLowerCase();
    var em = String(u.email || '').toLowerCase().trim();
    var nome = String(u.nome || '').toLowerCase().trim();
    if (id === 'gestor-master' || id === 'gestor') return true;
    if (em === 'gestor@ibndiamantino.com.br') return true;
    if (nome === 'gestor master' || nome === 'gestor máster') return true;
    // login legado só com usuário "gestor"
    if (String(u.usuario || '').toLowerCase() === 'gestor' && u.nivel === 'gestor') return true;
    try {
        if (typeof CONTAS_MESTRAS !== 'undefined' && Array.isArray(CONTAS_MESTRAS)) {
            for (var i = 0; i < CONTAS_MESTRAS.length; i++) {
                var c = CONTAS_MESTRAS[i];
                if (c.nivel === 'gestor' && (String(c.id) === String(u.id) || (c.email && String(c.email).toLowerCase() === em))) {
                    return true;
                }
            }
        }
    } catch (e) {}
    return false;
}

/** Secretaria OU gestor (quem “manda no escritório”) */
function isAdmin(u) {
    u = u || getUsuarioLogado();
    return !!(u && (u.nivel === 'admin' || u.nivel === 'gestor'));
}

/** Só secretaria (não inclui gestor) — raro; preferir isAdmin */
function isSecretaria(u) {
    u = u || getUsuarioLogado();
    return !!(u && u.nivel === 'admin');
}

/** Aprovar membro e definir liderança de célula/ministério */
function podeAprovarLiderancas(u) {
    return isAdmin(u);
}

/** Buscar/exportar relatórios de células (secretaria + gestor). Líder só a própria no export filtrado. */
function podeExportarRelatoriosGeral(u) {
    return isAdmin(u);
}

/** Nomear ou rebaixar administradores (secretaria) — só o gestor */
function podeNomearAdmin(u) {
    return isGestor(u);
}

/** Contas master do sistema — nunca entram nos limites de vaga */
function ehContaMasterSistema(m) {
    if (!m) return false;
    try { if (typeof isContaSistema === 'function' && isContaSistema(m)) return true; } catch (e) {}
    var id = String(m.id || '').toLowerCase();
    var em = String(m.email || '').toLowerCase();
    if (id === 'gestor-master' || id === 'admin-master') return true;
    if (em === 'gestor@ibndiamantino.com.br' || em === 'admin@ibndiamantino.com.br') return true;
    return false;
}

const LIMITE_ADMINS = 3;
const LIMITE_GESTORES = 2;

function contarAdminsMembros() {
    return lerMembros().filter(function (m) {
        return m && m.nivel === 'admin' && !ehContaMasterSistema(m);
    }).length;
}
function contarGestoresMembros() {
    return lerMembros().filter(function (m) {
        return m && m.nivel === 'gestor' && !ehContaMasterSistema(m);
    }).length;
}
function listarAdminsMembros() {
    return lerMembros().filter(function (m) {
        return m && m.nivel === 'admin' && !ehContaMasterSistema(m);
    }).sort(function (a, b) { return String(a.nome||'').localeCompare(String(b.nome||'')); });
}
function listarGestoresMembros() {
    return lerMembros().filter(function (m) {
        return m && m.nivel === 'gestor' && !ehContaMasterSistema(m);
    }).sort(function (a, b) { return String(a.nome||'').localeCompare(String(b.nome||'')); });
}

/** Define nivel admin em um membro cadastrado (só gestor). Máx. 3 admins. */
function nomearComoAdmin(membroId) {
    if (!podeNomearAdmin()) return { sucesso: false, mensagem: 'Somente o gestor pode nomear a secretaria (admin).' };
    const lista = lerMembros();
    const idx = lista.findIndex(m => String(m.id) === String(membroId));
    if (idx === -1) return { sucesso: false, mensagem: 'Membro não encontrado.' };
    if (ehContaMasterSistema(lista[idx])) return { sucesso: false, mensagem: 'Conta de sistema não pode ser alterada.' };
    if (lista[idx].nivel === 'gestor') return { sucesso: false, mensagem: 'Esta pessoa já é gestor. Rebaixe antes se quiser torná-la só admin.' };
    if (lista[idx].nivel === 'admin') return { sucesso: false, mensagem: 'Já é administrador.' };
    if (contarAdminsMembros() >= LIMITE_ADMINS) {
        return { sucesso: false, mensagem: 'Limite de ' + LIMITE_ADMINS + ' administradores atingido. Remova um antes de nomear outro.' };
    }
    lista[idx].nivel = 'admin';
    lista[idx].cargo = 'Secretaria';
    lista[idx].status = 'aprovado';
    if (typeof marcarMembroAtualizado === 'function') marcarMembroAtualizado(lista[idx]);
    salvarMembros(lista);
    try { enviarMembroParaNuvem(lista[idx]); } catch (e) {}
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.registrarAtividade) {
            IBNNuvem.registrarAtividade('nomear_admin', 'Nomeou admin/secretaria: ' + lista[idx].nome);
        }
    } catch (e) {}
    return { sucesso: true, membro: lista[idx], mensagem: lista[idx].nome + ' agora é administrador (' + contarAdminsMembros() + '/' + LIMITE_ADMINS + ').' };
}

/** Remove nível admin (volta a membro) — só gestor */
function removerNivelAdmin(membroId) {
    if (!podeNomearAdmin()) return { sucesso: false, mensagem: 'Somente o gestor pode remover admin.' };
    const lista = lerMembros();
    const idx = lista.findIndex(m => String(m.id) === String(membroId));
    if (idx === -1) return { sucesso: false, mensagem: 'Membro não encontrado.' };
    if (ehContaMasterSistema(lista[idx])) return { sucesso: false, mensagem: 'Conta master não pode ser removida aqui.' };
    if (lista[idx].nivel === 'gestor') return { sucesso: false, mensagem: 'Use a seção de gestores para rebaixar um gestor.' };
    lista[idx].nivel = 'membro';
    if (typeof marcarMembroAtualizado === 'function') marcarMembroAtualizado(lista[idx]);
    salvarMembros(lista);
    try { enviarMembroParaNuvem(lista[idx]); } catch (e) {}
    return { sucesso: true, mensagem: 'Admin removido — voltou a ser membro.' };
}

/** Nomeia segundo gestor (máx. 2 membros-gestores). Gestor master continua acima. */
function nomearComoGestor(membroId) {
    if (!isGestorMaster()) return { sucesso: false, mensagem: 'Somente o Gestor Master pode nomear gestores.' };
    const lista = lerMembros();
    const idx = lista.findIndex(m => String(m.id) === String(membroId));
    if (idx === -1) return { sucesso: false, mensagem: 'Membro não encontrado.' };
    if (ehContaMasterSistema(lista[idx])) return { sucesso: false, mensagem: 'Conta de sistema.' };
    if (lista[idx].nivel === 'gestor') return { sucesso: false, mensagem: 'Já é gestor.' };
    if (contarGestoresMembros() >= LIMITE_GESTORES) {
        return { sucesso: false, mensagem: 'Limite de ' + LIMITE_GESTORES + ' gestores atingido. Rebaixe um antes de nomear outro.' };
    }
    lista[idx].nivel = 'gestor';
    lista[idx].cargo = 'Pastor / Gestor';
    lista[idx].status = 'aprovado';
    if (typeof marcarMembroAtualizado === 'function') marcarMembroAtualizado(lista[idx]);
    salvarMembros(lista);
    try { enviarMembroParaNuvem(lista[idx]); } catch (e) {}
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.registrarAtividade) {
            IBNNuvem.registrarAtividade('nomear_gestor', 'Nomeou gestor: ' + lista[idx].nome);
        }
    } catch (e) {}
    return { sucesso: true, membro: lista[idx], mensagem: lista[idx].nome + ' agora é gestor (' + contarGestoresMembros() + '/' + LIMITE_GESTORES + '). O Gestor Master continua acima de todos.' };
}

/** Rebaixa gestor membro para admin (não mexe no master) */
function rebaixarGestorParaAdmin(membroId) {
    if (!isGestorMaster()) return { sucesso: false, mensagem: 'Somente o Gestor Master pode rebaixar gestores.' };
    const lista = lerMembros();
    const idx = lista.findIndex(m => String(m.id) === String(membroId));
    if (idx === -1) return { sucesso: false, mensagem: 'Membro não encontrado.' };
    if (ehContaMasterSistema(lista[idx])) return { sucesso: false, mensagem: 'Gestor Master não pode ser rebaixado.' };
    if (lista[idx].nivel !== 'gestor') return { sucesso: false, mensagem: 'Esta pessoa não é gestor.' };
    // se for o único gestor e quem está logado for master, ok; se for o próprio único gestor-membro, permitir
    lista[idx].nivel = 'admin';
    lista[idx].cargo = 'Secretaria';
    if (typeof marcarMembroAtualizado === 'function') marcarMembroAtualizado(lista[idx]);
    salvarMembros(lista);
    try { enviarMembroParaNuvem(lista[idx]); } catch (e) {}
    return { sucesso: true, mensagem: 'Gestor rebaixado para administrador.' };
}


/** Remove nível gestor (volta a membro) — só Gestor Master. Para quem saiu da igreja. */
function removerNivelGestor(membroId) {
    if (!isGestorMaster()) return { sucesso: false, mensagem: 'Somente o Gestor Master pode remover gestores.' };
    const lista = lerMembros();
    const ix = lista.findIndex(m => String(m.id) === String(membroId));
    if (ix === -1) return { sucesso: false, mensagem: 'Membro não encontrado.' };
    if (ehContaMasterSistema(lista[ix])) return { sucesso: false, mensagem: 'Gestor Master não pode ser removido.' };
    if (lista[ix].nivel !== 'gestor') return { sucesso: false, mensagem: 'Esta pessoa não é gestor.' };
    lista[ix].nivel = 'membro';
    if (lista[ix].cargo === 'Pastor / Gestor' || lista[ix].cargo === 'Gestor') lista[ix].cargo = 'Membro';
    if (typeof marcarMembroAtualizado === 'function') marcarMembroAtualizado(lista[ix]);
    salvarMembros(lista);
    try { enviarMembroParaNuvem(lista[ix]); } catch (e) {}
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.registrarAtividade) {
            IBNNuvem.registrarAtividade('remover_gestor', 'Removeu gestor (voltou a membro): ' + lista[ix].nome);
        }
    } catch (e) {}
    return { sucesso: true, mensagem: (lista[ix].nome || 'Pessoa') + ' removida do cargo de gestor — voltou a ser membro.' };
}


function isLiderMinisterio(u, nomeMinisterio) {
    u = u || getUsuarioLogado();
    if (!u) return false;
    if (isAdmin(u) || isGestor(u)) return true;
    const alvo = nomeMinisterio ? normalizarNomeMinisterio(nomeMinisterio) : '';
    // Lista explícita de ministérios que lidera
    const lidera = Array.isArray(u.lideraMinisterios) ? u.lideraMinisterios : [];
    if (lidera.length) {
        if (!alvo) return true;
        if (lidera.some(function (m) { return normalizarNomeMinisterio(m) === alvo; })) return true;
    }
    if (u.lideraMinisterio && (!alvo || normalizarNomeMinisterio(u.lideraMinisterio) === alvo)) return true;
    if (u.nivel === 'lider_ministerio') {
        if (!alvo) return true;
        const mins = Array.isArray(u.ministerios) ? u.ministerios : [];
        return mins.some(function (m) { return normalizarNomeMinisterio(m) === alvo; });
    }
    // funcoes[] pode conter lider_ministerio
    if (Array.isArray(u.funcoes) && u.funcoes.indexOf('lider_ministerio') !== -1) {
        if (!alvo) return true;
        const mins2 = Array.isArray(u.ministerios) ? u.ministerios : [];
        return mins2.some(function (m) { return normalizarNomeMinisterio(m) === alvo; }) ||
            lidera.some(function (m) { return normalizarNomeMinisterio(m) === alvo; });
    }
    return false;
}

function isLiderCelula(u, celulaId) {
    u = u || getUsuarioLogado();
    if (!u) return false;
    if (isAdmin(u) || isGestor(u)) return true;
    if (u.lideraCelulaId && (!celulaId || String(u.lideraCelulaId) === String(celulaId))) return true;
    if (Array.isArray(u.celulas)) {
        const temPapelLider = u.celulas.some(function (c) {
            const id = typeof idCelulaDe === 'function' ? idCelulaDe(c) : (c && c.id);
            const papel = String(c.papel || c.funcao || '').toLowerCase();
            const papeisArr = Array.isArray(c.papeis) ? c.papeis.map(function(x){ return String(x).toLowerCase(); }) : [];
            const ehLider = papel === 'lider' || papel === 'líder' || papel.indexOf('lider') !== -1 ||
                papeisArr.indexOf('lider') !== -1 || papeisArr.indexOf('lider_treino') !== -1;
            if (!ehLider && u.nivel !== 'lider_celula' && !(Array.isArray(u.funcoes) && u.funcoes.indexOf('lider_celula') !== -1)) {
                return false;
            }
            if (!celulaId) return ehLider || u.nivel === 'lider_celula' || (Array.isArray(u.funcoes) && u.funcoes.indexOf('lider_celula') !== -1);
            return String(id) === String(celulaId) && (ehLider || u.nivel === 'lider_celula' || (Array.isArray(u.funcoes) && u.funcoes.indexOf('lider_celula') !== -1) || String(u.lideraCelulaId) === String(celulaId));
        });
        if (temPapelLider) return true;
    }
    if (u.nivel === 'lider_celula') {
        if (!celulaId) return true;
        return Array.isArray(u.celulas) && u.celulas.some(function (c) {
            return (typeof idCelulaDe === 'function' ? idCelulaDe(c) : c.id) === celulaId;
        });
    }
    return false;
}

function podePostarFotoCelula(celulaId) {
    const u = getUsuarioLogado();
    if (!u) return false;
    if (isAdmin(u)) return true;
    return Array.isArray(u.celulas) && u.celulas.some(c => c.id === celulaId);
}


/** Normaliza nome/slug de ministério para comparação */
function normalizarNomeMinisterio(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '')
        .trim();
}

/**
 * Pode postar foto neste ministério?
 * - admin/gestor: qualquer
 * - ministério "geral" / "outros": qualquer membro logado
 * - demais: só se o membro participa daquele ministério no cadastro
 */
function podePostarFotoMinisterio(nomeOuSlug) {
    const u = getUsuarioLogado();
    if (!u) return false;
    if (isAdmin(u)) return true;
    const alvo = normalizarNomeMinisterio(nomeOuSlug);
    if (!alvo || alvo === 'geral' || alvo === 'geraloutros' || alvo === 'outros') return true;
    const mins = Array.isArray(u.ministerios) ? u.ministerios : [];
    if (!mins.length) return false;
    return mins.some(function (m) {
        const n = normalizarNomeMinisterio(m);
        return n === alvo || n.indexOf(alvo) !== -1 || alvo.indexOf(n) !== -1;
    });
}

/** Lista legível dos ministérios em que o membro pode postar (+ Geral) */
function ministeriosQuePodePostar() {
    const u = getUsuarioLogado();
    if (!u) return ['Geral / Outros'];
    if (isAdmin(u)) {
        return (typeof LISTA_MINISTERIOS !== 'undefined' ? LISTA_MINISTERIOS.slice() : []).concat(['Geral / Outros']);
    }
    const mins = Array.isArray(u.ministerios) ? u.ministerios.slice() : [];
    if (mins.indexOf('Geral / Outros') === -1 && mins.indexOf('Geral') === -1) {
        mins.push('Geral / Outros');
    }
    return mins.length ? mins : ['Geral / Outros'];
}


/** Pode remover esta foto? autor da foto, admin ou gestor */
function podeRemoverFoto(foto) {
    const u = getUsuarioLogado();
    if (!u || !foto) return false;
    if (isGestor(u) || isAdmin(u)) return true;
    if (u.nivel === 'gestor' || u.nivel === 'admin') return true;
    const uid = String(u.id || '');
    const aid = String(foto.autorId || '');
    if (uid && aid && uid === aid) return true;
    // fallback: mesmo nome do autor (cadastros antigos sem autorId)
    if (u.nome && foto.autor && String(u.nome).toLowerCase().trim() === String(foto.autor).toLowerCase().trim()) return true;
    if (u.nome && foto.autorNome && String(u.nome).toLowerCase().trim() === String(foto.autorNome).toLowerCase().trim()) return true;
    return false;
}

function removerFotoMinisterioLocal(id) {
    try {
        const lista = JSON.parse(localStorage.getItem(CHAVE_FOTOS) || '[]');
        const nova = lista.filter(function (f) { return String(f.id) !== String(id); });
        localStorage.setItem(CHAVE_FOTOS, JSON.stringify(nova));
        return { sucesso: true };
    } catch (e) {
        return { sucesso: false, mensagem: String(e) };
    }
}

function removerFotoCelulaLocal(id) {
    try {
        const lista = lerFotosCelulas();
        const nova = lista.filter(function (f) { return String(f.id) !== String(id); });
        salvarFotosCelulas(nova);
        return { sucesso: true };
    } catch (e) {
        return { sucesso: false, mensagem: String(e) };
    }
}

function podeGerenciarFotosMinisterio(nomeMinisterio) {
    return isLiderMinisterio(null, nomeMinisterio);
}

function atualizarPerfil(dadosNovos) {
    const usuario = getUsuarioLogado();
    if (!usuario) return { sucesso: false };

    const lista = lerMembros();
    const indice = lista.findIndex(m => String(m.id) === String(usuario.id));
    if (indice === -1) return { sucesso: false };

    const atual = lista[indice];
    const { nivel, status, funcoes, cargo, funcoesAprovadas, ...seguros } = dadosNovos;
    // cargo / funções oficiais só mudam com aprovação da gestão
    delete seguros.cargo;
    delete seguros.funcoesAprovadas;

    // ---- Diff: tudo que o membro mudou no formulário vira pendência da gestão ----
    var resumoPend = [];
    var camposDados = [];
    function normTxt(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
    function normTel(v) { return String(v || '').replace(/\D/g, ''); }
    function idsCelulas(arr) {
        return (Array.isArray(arr) ? arr : []).map(function (c) {
            return String((c && c.id) || c || '').toLowerCase();
        }).filter(Boolean).sort().join('|');
    }
    function nomesMins(arr) {
        return (Array.isArray(arr) ? arr : []).map(function (x) {
            return String(x).trim().toLowerCase();
        }).filter(Boolean).sort().join('|');
    }

    if (seguros.celulas) {
        const v = validarCelulas(seguros.celulas);
        if (v.erro) return { sucesso: false, mensagem: v.erro };
        seguros.celulas = v.lista;
        if (idsCelulas(seguros.celulas) !== idsCelulas(atual.celulas)) {
            resumoPend.push('Célula(s) alterada(s) pelo membro');
        }
    }

    if (Array.isArray(dadosNovos.funcoesSolicitadas)) {
        const aprovadas = Array.isArray(atual.funcoesAprovadas) && atual.funcoesAprovadas.length
            ? atual.funcoesAprovadas
            : (atual.cargo ? [atual.cargo] : ['Membro(a)']);
        // solicita só o que ainda não está aprovado
        const pedidas = dadosNovos.funcoesSolicitadas.filter(function (f) {
            return aprovadas.indexOf(f) === -1 && String(f).indexOf('Membro') !== 0;
        });
        seguros.funcoesSolicitadas = pedidas;
        if (pedidas.length) {
            resumoPend.push('Funções pedidas: ' + pedidas.join(', '));
        }
    }

    // Ministérios: qualquer marcação nova ou que ainda não foi aprovada = em análise
    if (Array.isArray(dadosNovos.ministerios)) {
        var minsNovos = dadosNovos.ministerios.map(function (x) { return String(x).trim(); }).filter(Boolean);
        var stMap = Object.assign({}, atual.ministeriosStatus || {});
        var minsAntes = Array.isArray(atual.ministerios) ? atual.ministerios : [];
        var novosNomes = [];
        minsNovos.forEach(function (nome) {
            var key = String(nome).trim();
            var jaTinha = minsAntes.some(function (x) {
                return String(x).trim().toLowerCase() === key.toLowerCase();
            });
            var st = stMap[key] || stMap[key.toLowerCase()] || '';
            // novo OU ainda não aprovado pela gestão → em análise (adm/gestor vê)
            if (!jaTinha || (st !== 'aprovado' && st !== 'ok')) {
                stMap[key] = 'em_analise';
                if (!jaTinha) novosNomes.push(key);
            }
        });
        // remove status de ministérios que o membro desmarcou
        var removidos = [];
        Object.keys(stMap).forEach(function (k) {
            var ainda = minsNovos.some(function (n) {
                return String(n).toLowerCase() === String(k).toLowerCase();
            });
            if (!ainda) {
                if (stMap[k] === 'aprovado' || stMap[k] === 'ok') removidos.push(k);
                delete stMap[k];
            }
        });
        minsAntes.forEach(function (x) {
            var nome = String(x).trim();
            var ainda = minsNovos.some(function (n) {
                return String(n).toLowerCase() === nome.toLowerCase();
            });
            if (!ainda && removidos.indexOf(nome) === -1) removidos.push(nome);
        });
        seguros.ministerios = minsNovos;
        seguros.ministeriosStatus = stMap;
        if (nomesMins(minsNovos) !== nomesMins(minsAntes)) {
            if (novosNomes.length) resumoPend.push('Ministérios novos em análise: ' + novosNomes.join(', '));
            if (removidos.length) resumoPend.push('Ministérios desmarcados pelo membro: ' + removidos.join(', '));
            if (!novosNomes.length && !removidos.length) {
                resumoPend.push('Ministérios alterados (conferir alocação)');
            }
        }
        // Sempre lista o que ainda está em análise (inclui marcar mais um depois do laranja)
        var aindaAnalise = minsNovos.filter(function (n) {
            var st = stMap[n] || stMap[String(n).toLowerCase()] || '';
            return st === 'em_analise' || st === 'pendente' || !st;
        });
        if (aindaAnalise.length) {
            var linhaMin = 'Ministérios em análise: ' + aindaAnalise.join(', ');
            if (resumoPend.indexOf(linhaMin) === -1 &&
                !resumoPend.some(function (r) { return r.indexOf('Ministérios novos') === 0; })) {
                resumoPend.push(linhaMin);
            }
        }
    }

    // Dados cadastrais (telefone, e-mail, endereço, etc.)
    var mapaCampos = [
        { k: 'telefone', label: 'telefone', cmp: function (a, b) { return normTel(a) !== normTel(b); } },
        { k: 'email', label: 'e-mail', cmp: function (a, b) { return normTxt(a) !== normTxt(b); } },
        { k: 'endereco', label: 'endereço', cmp: function (a, b) { return normTxt(a) !== normTxt(b); } },
        { k: 'municipio', label: 'município', cmp: function (a, b) { return normTxt(a) !== normTxt(b); } },
        { k: 'uf', label: 'UF', cmp: function (a, b) { return normTxt(a) !== normTxt(b); } },
        { k: 'nascimento', label: 'nascimento', cmp: function (a, b) { return normTxt(a) !== normTxt(b); } },
        { k: 'estadoCivil', label: 'estado civil', cmp: function (a, b) { return normTxt(a) !== normTxt(b); } },
        { k: 'sexo', label: 'sexo', cmp: function (a, b) { return normTxt(a) !== normTxt(b); } },
        { k: 'batismo', label: 'batismo', cmp: function (a, b) { return normTxt(a) !== normTxt(b); } },
        { k: 'dataBatismo', label: 'data batismo', cmp: function (a, b) { return normTxt(a) !== normTxt(b); } },
        { k: 'funcaoEspecifica', label: 'função específica', cmp: function (a, b) { return normTxt(a) !== normTxt(b); } },
        { k: 'observacoes', label: 'observações', cmp: function (a, b) { return normTxt(a) !== normTxt(b); } }
    ];
    mapaCampos.forEach(function (c) {
        if (dadosNovos[c.k] === undefined) return;
        if (c.cmp(dadosNovos[c.k], atual[c.k])) camposDados.push(c.label);
    });
    if (camposDados.length) {
        resumoPend.push('Dados cadastrais alterados: ' + camposDados.join(', '));
    }

    // Junta com pendências anteriores ainda não vistas pela gestão
    var ant = atual.alteracoesPendentesGestao || {};
    var resumoAnt = Array.isArray(ant.resumo) ? ant.resumo.slice() : [];
    resumoPend.forEach(function (linha) {
        if (resumoAnt.indexOf(linha) === -1) resumoAnt.push(linha);
    });
    if (resumoAnt.length || resumoPend.length) {
        seguros.alteracoesPendentesGestao = {
            em: new Date().toISOString(),
            resumo: resumoAnt.length ? resumoAnt : resumoPend,
            camposDados: camposDados,
            porMembro: true
        };
    }

    lista[indice] = { ...atual, ...seguros };
    try { if (typeof marcarMembroAtualizado === 'function') marcarMembroAtualizado(lista[indice]); } catch (e0) {}
    salvarMembros(lista);
    iniciarSessao(lista[indice]);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.registrarAtividade) {
            var det = (seguros.alteracoesPendentesGestao && seguros.alteracoesPendentesGestao.resumo)
                ? seguros.alteracoesPendentesGestao.resumo.join('; ')
                : 'Atualizou dados cadastrais';
            IBNNuvem.registrarAtividade('editar_perfil', det, lista[indice]);
        }
    } catch (e) {}

    // Retorna Promise: local ok + status real da nuvem
    return Promise.resolve(enviarMembroParaNuvem(lista[indice])).then(function (rn) {
        var nuvemOk = !!(rn && rn.sucesso);
        var msgLocal = 'Dados salvos neste aparelho.';
        var msgNuvem = nuvemOk
            ? ' Também enviados para a nuvem (gestão pode ver).'
            : (rn && rn.semNuvem
                ? ' Nuvem offline neste aparelho — gestão só verá após sincronizar.'
                : ' Atenção: não foi possível enviar à nuvem' + (rn && rn.mensagem ? ' (' + rn.mensagem + ')' : '') + '.');
        return {
            sucesso: true,
            local: true,
            nuvem: nuvemOk,
            mensagem: msgLocal + msgNuvem,
            membro: lista[indice]
        };
    }).catch(function () {
        return {
            sucesso: true,
            local: true,
            nuvem: false,
            mensagem: 'Dados salvos neste aparelho. Não foi possível confirmar o envio à nuvem.',
            membro: lista[indice]
        };
    });
}

function aprovarMembro(membroId, alocacao) {
    if (!isAdmin()) return { sucesso: false, mensagem: 'Sem permissão.' };

    const lista = lerMembros();
    // Compara id como string (evita falha number vs string entre aparelhos)
    const idx = lista.findIndex(m => String(m.id) === String(membroId));
    if (idx === -1) return { sucesso: false, mensagem: 'Membro não encontrado.' };

    const m = lista[idx];
    m.status = 'aprovado';

    if (alocacao) {
        if (alocacao.celulas) {
            const v = validarCelulas(alocacao.celulas);
            if (v.erro) return { sucesso: false, mensagem: v.erro };
            m.celulas = v.lista;
        }
        if (alocacao.ministerios) m.ministerios = alocacao.ministerios;
        if (alocacao.cargo) m.cargo = alocacao.cargo;
        if (alocacao.funcaoEspecifica !== undefined) m.funcaoEspecifica = alocacao.funcaoEspecifica;
        if (alocacao.lideraCelulaId !== undefined) m.lideraCelulaId = alocacao.lideraCelulaId;
        if (alocacao.lideraMinisterio !== undefined) m.lideraMinisterio = alocacao.lideraMinisterio;
        if (alocacao.lideraMinisterios !== undefined) m.lideraMinisterios = alocacao.lideraMinisterios;
        if (alocacao.funcaoEspecifica !== undefined) m.funcaoEspecifica = alocacao.funcaoEspecifica;
        if (alocacao.nivel) m.nivel = alocacao.nivel;
        if (alocacao.funcoes) m.funcoes = alocacao.funcoes;
        // nível efetivo: gestor > admin > lider_* combinados
        if (Array.isArray(m.funcoes) && m.funcoes.indexOf('gestor') !== -1) m.nivel = 'gestor';
        else if (Array.isArray(m.funcoes) && m.funcoes.indexOf('admin') !== -1) m.nivel = 'admin';
        else if (Array.isArray(m.funcoes) && m.funcoes.indexOf('lider_celula') !== -1 && m.funcoes.indexOf('lider_ministerio') !== -1) {
            m.nivel = m.nivel === 'admin' || m.nivel === 'gestor' ? m.nivel : 'lider_celula';
        } else if (Array.isArray(m.funcoes) && m.funcoes.indexOf('lider_celula') !== -1) m.nivel = (m.nivel === 'admin' || m.nivel === 'gestor') ? m.nivel : 'lider_celula';
        else if (Array.isArray(m.funcoes) && m.funcoes.indexOf('lider_ministerio') !== -1) m.nivel = (m.nivel === 'admin' || m.nivel === 'gestor') ? m.nivel : 'lider_ministerio';
    }

    if (!alocacao || !alocacao.nivel) {
        if (m.cargo === 'Líder de Ministério' || m.cargo === 'Líder de Ministério') m.nivel = 'lider_ministerio';
        else if (m.cargo === 'Líder de Célula') m.nivel = 'lider_celula';
        else if (!['admin', 'gestor'].includes(m.nivel)) m.nivel = 'membro';
    }

    // Ao aprovar/alocar, limpa pedidos e grava funções oficiais
    m.funcoesSolicitadas = [];
    const aprovadas = [];
    if (m.cargo) aprovadas.push(m.cargo);
    if (Array.isArray(m.funcoes)) {
        if (m.funcoes.indexOf('lider_celula') !== -1 && aprovadas.indexOf('Líder de Célula') === -1) aprovadas.push('Líder de Célula');
        if (m.funcoes.indexOf('lider_ministerio') !== -1 && aprovadas.indexOf('Líder de Ministério') === -1) aprovadas.push('Líder de Ministério');
        if (m.funcoes.indexOf('lider_treino') !== -1 && aprovadas.indexOf('Líder em treinamento') === -1) aprovadas.push('Líder em treinamento');
        if (m.funcoes.indexOf('anfitriao') !== -1 && aprovadas.indexOf('Anfitrião') === -1) aprovadas.push('Anfitrião');
    }
    if (!aprovadas.length) aprovadas.push('Membro(a)');
    m.funcoesAprovadas = aprovadas;

    // Ministérios alocados pela gestão ficam aprovados; os que saíram somem do status
    if (!m.ministeriosStatus) m.ministeriosStatus = {};
    var minsFinais = Array.isArray(m.ministerios) ? m.ministerios : [];
    var novoSt = {};
    minsFinais.forEach(function (nome) {
        novoSt[String(nome).trim()] = 'aprovado';
    });
    m.ministeriosStatus = novoSt;
    // Gestão conferiu a ficha → limpa aviso de alterações do formulário
    m.alteracoesPendentesGestao = null;

    try { if (typeof marcarMembroAtualizado === 'function') marcarMembroAtualizado(m); } catch (eA) {}
    lista[idx] = m;
    salvarMembros(lista);
    // Força gravação na nuvem (aprovação da gestão não pode ser bloqueada por cópia antiga)
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.sincronizarUmMembro) {
            IBNNuvem.sincronizarUmMembro(m, { force: true }).then(function (r) {
                if (r && !r.sucesso) console.warn('Aprovação não subiu:', r.mensagem);
            }).catch(function (e) { console.warn('Aprovação nuvem:', e); });
        } else {
            enviarMembroParaNuvem(m);
        }
    } catch (eB) {}
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.registrarAtividade) {
            var uGest = (typeof getUsuarioLogado === 'function') ? getUsuarioLogado() : null;
            var detMin = Array.isArray(m.ministerios) ? m.ministerios.join(', ') : '';
            IBNNuvem.registrarAtividade(
                'aprovar_alocacao',
                'Aprovou/alocou ' + (m.nome || '') + (detMin ? ' · Ministérios: ' + detMin : ''),
                uGest
            );
        }
    } catch (eLog) {}
    return { sucesso: true, membro: m };
}

function rejeitarMembro(membroId) {
    if (!isAdmin()) return { sucesso: false, mensagem: 'Sem permissão.' };
    const lista = lerMembros();
    const idx = lista.findIndex(m => String(m.id) === String(membroId));
    if (idx === -1) return { sucesso: false, mensagem: 'Membro não encontrado.' };
    lista[idx].status = 'rejeitado';
    if (typeof marcarMembroAtualizado === 'function') marcarMembroAtualizado(lista[idx]);
    salvarMembros(lista);
    // Gestão: sempre force (não pode ser bloqueada por cópia antiga / relógio)
    try { enviarMembroParaNuvem(lista[idx], { force: true }); } catch (e) {}
    return { sucesso: true };
}

function buscarPorIdentificador(identificador) {
    const id = (identificador || '').trim().toLowerCase();
    const tel = id.replace(/\D/g, '');
    const lista = lerMembros();
    return lista.find(m => {
        const emailOk = (m.email || '').toLowerCase() === id;
        const telOk = tel && (m.telefone || '').replace(/\D/g, '') === tel;
        return emailOk || telOk;
    }) || null;
}

function verificarRespostaSeguranca(identificador, resposta) {
    const membro = buscarPorIdentificador(identificador);
    if (!membro) return { sucesso: false, mensagem: 'Cadastro não encontrado.' };
    if (!membro.perguntaSeguranca || !membro.respostaSeguranca) {
        return { sucesso: false, mensagem: 'Este cadastro não possui pergunta de segurança. Fale com a secretaria.' };
    }
    const resp = (resposta || '').toLowerCase().trim();
    if (resp !== membro.respostaSeguranca) {
        return { sucesso: false, mensagem: 'Resposta incorreta.' };
    }
    return { sucesso: true, pergunta: membro.perguntaSeguranca, membroId: membro.id };
}

function gerarSenhaTemporaria() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let s = 'IBN-';
    for (let i = 0; i < 6; i++) {
        s += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return s;
}

function resetarSenhaPorSeguranca(identificador, resposta) {
    const check = verificarRespostaSeguranca(identificador, resposta);
    if (!check.sucesso) return check;

    const lista = lerMembros();
    const idx = lista.findIndex(m => m.id === check.membroId);
    if (idx === -1) return { sucesso: false, mensagem: 'Erro interno.' };

    const temp = gerarSenhaTemporaria();
    lista[idx].senha = temp;
    lista[idx].deveTrocarSenha = true;
    salvarMembros(lista);

    return {
        sucesso: true,
        senhaTemporaria: temp,
        mensagem: 'Senha temporária gerada. Anote e troque no próximo acesso.'
    };
}

function resetarSenhaPorGestor(membroId) {
    if (!isAdmin()) return { sucesso: false, mensagem: 'Sem permissão.' };
    const lista = lerMembros();
    const idx = lista.findIndex(m => String(m.id) === String(membroId));
    if (idx === -1) return { sucesso: false, mensagem: 'Membro não encontrado.' };

    const temp = gerarSenhaTemporaria();
    lista[idx].senha = temp;
    lista[idx].deveTrocarSenha = true;
    salvarMembros(lista);
    // Sobe senha nova para a nuvem (outros aparelhos)
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.sincronizarUmMembro) {
            IBNNuvem.sincronizarUmMembro(lista[idx]);
        }
    } catch (e) {}
    return {
        sucesso: true,
        senhaTemporaria: temp,
        membro: lista[idx],
        telefoneCadastro: lista[idx].telefone || '',
        emailCadastro: lista[idx].email || ''
    };
}

function trocarSenha(senhaAtual, senhaNova, senhaNova2) {
    const usuario = getUsuarioLogado();
    if (!usuario) return { sucesso: false, mensagem: 'Não logado.' };

    if (String(usuario.id).includes('master')) {
        return { sucesso: false, mensagem: 'Contas mestras não alteram senha por aqui.' };
    }

    const lista = lerMembros();
    const idx = lista.findIndex(m => String(m.id) === String(usuario.id));
    if (idx === -1) return { sucesso: false, mensagem: 'Membro não encontrado.' };

    const obrigatorio = !!lista[idx].deveTrocarSenha;
    const atual = String(senhaAtual || '').trim();
    const nova = String(senhaNova || '').trim();
    const nova2 = senhaNova2 !== undefined && senhaNova2 !== null ? String(senhaNova2).trim() : nova;

    if (!obrigatorio) {
        if (!atual || atual !== String(lista[idx].senha || '')) {
            return { sucesso: false, mensagem: 'Senha atual incorreta.' };
        }
    } else if (atual && atual !== String(lista[idx].senha || '')) {
        // se informou senha atual na troca obrigatória, precisa bater
        return { sucesso: false, mensagem: 'Senha temporária incorreta.' };
    }

    if (!nova || nova.length < 4) {
        return { sucesso: false, mensagem: 'Nova senha precisa ter pelo menos 4 caracteres.' };
    }
    if (nova !== nova2) {
        return { sucesso: false, mensagem: 'A confirmação da nova senha não confere.' };
    }
    if (nova === String(lista[idx].senha || '')) {
        return { sucesso: false, mensagem: 'A nova senha deve ser diferente da temporária.' };
    }

    lista[idx].senha = nova;
    lista[idx].deveTrocarSenha = false;
    salvarMembros(lista);
    iniciarSessao(lista[idx]);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.sincronizarUmMembro) {
            IBNNuvem.sincronizarUmMembro(lista[idx]);
        }
    } catch (e) {}
    return { sucesso: true, mensagem: 'Senha alterada com sucesso.' };
}

function lerFotosCelulas() {
    try {
        return JSON.parse(localStorage.getItem(CHAVE_FOTOS_CELULAS) || '[]');
    } catch {
        return [];
    }
}

function salvarFotosCelulas(lista) {
    localStorage.setItem(CHAVE_FOTOS_CELULAS, JSON.stringify(lista));
}

function adicionarFotoCelula(foto) {
    const u = getUsuarioLogado();
    if (!u) return { sucesso: false, mensagem: 'Faça login.' };
    if (!podePostarFotoCelula(foto.celulaId)) {
        return { sucesso: false, mensagem: 'Você só pode postar fotos das células em que participa.' };
    }
    const lista = lerFotosCelulas();
    lista.unshift({
        id: 'fc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        ...foto,
        autorId: u.id,
        autorNome: u.nome,
        data: new Date().toISOString()
    });
    salvarFotosCelulas(lista);
    const nova = lista[0];
    try {
        if (typeof IBNNuvem !== 'undefined') {
            if (IBNNuvem.salvarFotoCelulaNuvem) IBNNuvem.salvarFotoCelulaNuvem(nova);
            if (IBNNuvem.registrarAtividade) {
                IBNNuvem.registrarAtividade('foto_celula', 'Foto na célula ' + (foto.celulaId || ''), u);
            }
        }
    } catch (e) {}
    return { sucesso: true };
}


/** Recuperação por nome + telefone + data de nascimento */
function recuperarSenhaPorDados(nome, telefone, nascimento) {
    const telNorm = String(telefone || '').replace(/\D/g, '');
    const nascIso = normalizarDataParaISO(nascimento || '');

    if (!(nome || '').trim() || telNorm.length < 8 || !nascIso) {
        return { sucesso: false, mensagem: 'Preencha nome, telefone e data de nascimento (dd/mm/aaaa).' };
    }

    const lista = lerMembros();
    // 1) Mesma pessoa (3 nomes + nascimento) + telefone flexível
    let membro = null;
    const mesma = buscarMesmaPessoa(nome, nascimento, lista);
    if (mesma) {
        const telCad = String(mesma.telefone || '').replace(/\D/g, '');
        const telOk = !telCad || telCad === telNorm || telCad.endsWith(telNorm.slice(-8)) || telNorm.endsWith(telCad.slice(-8))
            || (typeof telefonesIguais === 'function' && telefonesIguais(mesma.telefone, telNorm));
        if (telOk) membro = mesma;
    }
    // 2) Fallback: telefone + nascimento (nome pode ter variado)
    if (!membro) {
        membro = lista.find(function (m) {
            const nascM = normalizarDataParaISO(m.nascimento || m.dataNascimento || '');
            if (nascM !== nascIso) return false;
            const telCad = String(m.telefone || '').replace(/\D/g, '');
            return telCad && (telCad === telNorm || telCad.endsWith(telNorm.slice(-8)) || telNorm.endsWith(telCad.slice(-8))
                || (typeof telefonesIguais === 'function' && telefonesIguais(m.telefone, telNorm)));
        }) || null;
    }
    // 3) Só telefone se for único na lista
    if (!membro) {
        const porTel = lista.filter(function (m) {
            const telCad = String(m.telefone || '').replace(/\D/g, '');
            return telCad && (telCad === telNorm || telCad.endsWith(telNorm.slice(-8)) || telNorm.endsWith(telCad.slice(-8)));
        });
        if (porTel.length === 1) membro = porTel[0];
    }

    if (!membro) {
        return {
            sucesso: false,
            mensagem: 'Algum dado não confere. Verifique e tente de novo.',
            precisaSecretaria: true
        };
    }

    const temp = gerarSenhaTemporaria();
    const idx = lista.findIndex(function (m) { return String(m.id) === String(membro.id); });
    if (idx < 0) return { sucesso: false, mensagem: 'Erro interno ao atualizar senha.' };
    lista[idx].senha = temp;
    lista[idx].deveTrocarSenha = true;
    // grava telefone digitado se o cadastrado estava vazio/diferente só de formatação
    if (telNorm && !lista[idx].telefone) lista[idx].telefone = telNorm;
    salvarMembros(lista);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.sincronizarUmMembro) {
            IBNNuvem.sincronizarUmMembro(lista[idx]);
        }
    } catch (e) {}

    return {
        sucesso: true,
        senhaTemporaria: temp,
        emailCadastro: lista[idx].email || '',
        telefoneCadastro: lista[idx].telefone || '',
        mensagem: 'Senha temporária gerada. Vale até você entrar e trocar a senha.'
    };
}

function obterPerguntaSeguranca(identificador) {
    const membro = buscarPorIdentificador(identificador);
    if (!membro) return { sucesso: false, mensagem: 'Cadastro não encontrado.' };
    if (!membro.perguntaSeguranca) {
        return { sucesso: false, mensagem: 'Sem pergunta de segurança. Fale com a secretaria.' };
    }
    return { sucesso: true, pergunta: membro.perguntaSeguranca };
}

// ---------- RELATÓRIOS DE CÉLULA ----------
const CHAVE_RELATORIOS_CELULA = 'ibn_relatorios_celula';

function lerRelatoriosCelula() {
    try {
        return JSON.parse(localStorage.getItem(CHAVE_RELATORIOS_CELULA) || '[]');
    } catch {
        return [];
    }
}

function salvarRelatoriosCelula(lista) {
    localStorage.setItem(CHAVE_RELATORIOS_CELULA, JSON.stringify(lista));
}

/** Membros vinculados a uma célula (por id) */
function idCelulaDe(c) {
    if (!c) return '';
    if (typeof c === 'string') return c;
    return c.id || '';
}

/** Membros da célula (aprovados e pendentes — já vinculados no cadastro) */
function membrosDaCelula(celulaId) {
    const lista = lerMembros().filter(function (m) {
        const st = (m.status || 'aprovado').toLowerCase();
        return st !== 'rejeitado' && st !== 'recusado';
    });
    return lista.filter(function (m) {
        if (!Array.isArray(m.celulas)) return false;
        return m.celulas.some(function (c) {
            return idCelulaDe(c) === celulaId;
        });
    });
}


/** Contas mestras de sistema — não entram na lista de membros da igreja */
function isContaSistema(m) {
    if (!m) return false;
    var id = String(m.id || '').toLowerCase();
    var email = String(m.email || '').toLowerCase().trim();
    var nome = String(m.nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
    var nivel = String(m.nivel || '').toLowerCase();
    var funcoes = Array.isArray(m.funcoes) ? m.funcoes.map(function (f) { return String(f).toLowerCase(); }) : [];
    // IDs fixos / legado
    if (id === 'gestor-master' || id === 'admin-master' || id.indexOf('legado-') === 0) return true;
    if (id === 'gestor' || id === 'admin') return true;
    // E-mails oficiais do sistema
    if (email === 'gestor@ibndiamantino.com.br' || email === 'admin@ibndiamantino.com.br') return true;
    // Nome típico das contas mestras (com ou sem nível)
    if (nome === 'gestor master' || nome === 'admin master' || nome === 'gestor máster' || nome === 'admin máster') return true;
    if (nome === 'gestor' && (nivel === 'gestor' || funcoes.indexOf('master') >= 0)) return true;
    if (nome === 'admin master' || (nome.indexOf('admin master') === 0)) return true;
    if (funcoes.indexOf('master') >= 0 && (nivel === 'gestor' || nivel === 'admin')) return true;
    if (typeof CONTAS_MESTRAS !== 'undefined' && Array.isArray(CONTAS_MESTRAS)) {
        for (var i = 0; i < CONTAS_MESTRAS.length; i++) {
            var c = CONTAS_MESTRAS[i];
            if (String(c.id).toLowerCase() === id) return true;
            if (c.email && String(c.email).toLowerCase().trim() === email) return true;
            if (c.nome && String(c.nome).toLowerCase().trim() === String(m.nome || '').toLowerCase().trim()) return true;
        }
    }
    return false;
}
function membrosReais() {
    return ((typeof lerMembros === 'function') ? lerMembros() : []).filter(function (m) {
        return !isContaSistema(m);
    });
}
function isLiderDoMinisterio(u, nomeMinisterio) {
    if (!u || !nomeMinisterio) return false;
    if (typeof isAdmin === 'function' && isAdmin(u)) return true;
    if (u.nivel === 'gestor' || u.nivel === 'admin') return true;
    // Somente se o cadastro diz que lidera ESTE ministério
    return lideraEsteMinisterio(u, nomeMinisterio);
}


// ========== MODELO DE FUNÇÕES POR MINISTÉRIO (formulário de escala) ==========
const CHAVE_MODELO_ESCALA = 'ibn_modelo_escala_ministerios';
/** Modelo padrão Atmosfera: função + quantidade sugerida */
const MODELO_ESCALA_PADRAO = {
    'Atmosfera': [
        { funcao: 'Balcão Inf.', qtd: 1 },
        { funcao: 'Estacionamento', qtd: 3 },
        { funcao: 'Saudação Festiva', qtd: 8 },
        { funcao: 'Saudação Recepção', qtd: 6 },
        { funcao: 'Recepção Casal', qtd: 2 },
        { funcao: 'Recepção Visitantes', qtd: 2 },
        { funcao: 'Altar', qtd: 2 },
        { funcao: 'Abertura', qtd: 1 },
        { funcao: 'Dízimo e Oferta', qtd: 1 },
        { funcao: 'Máquina Cartão', qtd: 1 },
        { funcao: 'Pregador', qtd: 1 },
        { funcao: 'Observação', qtd: 0 }
    ],
    'Acolhimento': [
        { funcao: 'Recepção porta', qtd: 2 },
        { funcao: 'Orientação visitantes', qtd: 2 },
        { funcao: 'Café / apoio', qtd: 2 }
    ],
    'Louvor': [
        { funcao: 'Vocal', qtd: 4 },
        { funcao: 'Violão', qtd: 1 },
        { funcao: 'Teclado', qtd: 1 },
        { funcao: 'Bateria', qtd: 1 },
        { funcao: 'Som', qtd: 1 }
    ],
    'Mídias Sociais': [
        { funcao: 'Câmera', qtd: 2 },
        { funcao: 'Transmissão', qtd: 1 },
        { funcao: 'Stories / posts', qtd: 1 }
    ],
    'Intercessão': [
        { funcao: 'Intercessor', qtd: 4 },
        { funcao: 'Coordenação', qtd: 1 }
    ]
};

function lerTodosModelosEscala() {
    try {
        var salvos = JSON.parse(localStorage.getItem(CHAVE_MODELO_ESCALA) || '{}');
        var base = JSON.parse(JSON.stringify(MODELO_ESCALA_PADRAO));
        Object.keys(salvos || {}).forEach(function (k) { base[k] = salvos[k]; });
        return base;
    } catch (e) {
        return JSON.parse(JSON.stringify(MODELO_ESCALA_PADRAO));
    }
}
function lerModeloFuncoesMinisterio(ministerio) {
    var all = lerTodosModelosEscala();
    if (all[ministerio] && all[ministerio].length) return all[ministerio];
    // genérico se não existir
    return [
        { funcao: 'Função 1', qtd: 1 },
        { funcao: 'Função 2', qtd: 2 },
        { funcao: 'Apoio', qtd: 2 }
    ];
}
function salvarModeloFuncoesMinisterio(ministerio, lista) {
    try {
        var salvos = JSON.parse(localStorage.getItem(CHAVE_MODELO_ESCALA) || '{}');
        salvos[ministerio] = lista || [];
        localStorage.setItem(CHAVE_MODELO_ESCALA, JSON.stringify(salvos));
    } catch (e) {}
}

/** Modelo de funções pendente de aprovação (líder solicita → admin/gestor aprova) */
const CHAVE_MODELO_ESCALA_PENDENTE = 'ibn_modelo_escala_pendente';

function lerModelosPendentes() {
    try { return JSON.parse(localStorage.getItem(CHAVE_MODELO_ESCALA_PENDENTE) || '{}'); }
    catch (e) { return {}; }
}
function salvarTodosModelosPendentes(obj) {
    try { localStorage.setItem(CHAVE_MODELO_ESCALA_PENDENTE, JSON.stringify(obj || {})); } catch (e) {}
}

/**
 * Líder solicita aprovação de um novo modelo de funções.
 * Não sobrescreve o modelo oficial até a secretaria/gestor aprovar.
 */
function solicitarAprovacaoModeloEscala(ministerio, lista, solicitadoPor) {
    if (!ministerio || !Array.isArray(lista) || !lista.length) {
        return { sucesso: false, mensagem: 'Informe o ministério e ao menos uma função.' };
    }
    var limpa = lista.filter(function (it) {
        return it && String(it.funcao || '').trim() && !/^observa/i.test(String(it.funcao));
    }).map(function (it) {
        return { funcao: String(it.funcao).trim(), qtd: Math.max(0, parseInt(it.qtd, 10) || 0) };
    });
    if (!limpa.length) return { sucesso: false, mensagem: 'Nenhuma função válida.' };
    var all = lerModelosPendentes();
    all[ministerio] = {
        lista: limpa,
        solicitadoPor: solicitadoPor || '',
        solicitadoEm: new Date().toISOString(),
        status: 'pendente'
    };
    salvarTodosModelosPendentes(all);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.registrarAtividade) {
            IBNNuvem.registrarAtividade(
                'modelo_escala_pendente',
                'Solicitou aprovação do formulário de escala: ' + ministerio + ' (' + limpa.length + ' funções)',
                typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null
            );
        }
    } catch (e) {}
    return { sucesso: true, mensagem: 'Modelo de ' + ministerio + ' enviado para aprovação da secretaria/gestor.' };
}

function listarModelosPendentes() {
    var all = lerModelosPendentes();
    var out = [];
    Object.keys(all || {}).forEach(function (min) {
        var p = all[min];
        if (p && p.status === 'pendente' && Array.isArray(p.lista) && p.lista.length) {
            out.push({
                ministerio: min,
                lista: p.lista,
                solicitadoPor: p.solicitadoPor || '',
                solicitadoEm: p.solicitadoEm || ''
            });
        }
    });
    return out;
}

function temModeloPendente(ministerio) {
    var all = lerModelosPendentes();
    var p = all[ministerio];
    return !!(p && p.status === 'pendente' && Array.isArray(p.lista) && p.lista.length);
}

function obterModeloPendente(ministerio) {
    var all = lerModelosPendentes();
    return all[ministerio] || null;
}

/** Admin/gestor aprova → grava no modelo oficial e remove o pendente */
function aprovarModeloPendente(ministerio) {
    if (!ministerio) return { sucesso: false, mensagem: 'Ministério inválido.' };
    var all = lerModelosPendentes();
    var p = all[ministerio];
    if (!p || !Array.isArray(p.lista) || !p.lista.length) {
        return { sucesso: false, mensagem: 'Não há modelo pendente para ' + ministerio + '.' };
    }
    salvarModeloFuncoesMinisterio(ministerio, p.lista);
    delete all[ministerio];
    salvarTodosModelosPendentes(all);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.registrarAtividade) {
            IBNNuvem.registrarAtividade(
                'modelo_escala_aprovado',
                'Aprovou formulário de escala: ' + ministerio,
                typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null
            );
        }
    } catch (e) {}
    return { sucesso: true, mensagem: 'Modelo de ' + ministerio + ' aprovado e publicado.' };
}

/** Admin/gestor recusa → remove o pendente sem alterar o oficial */
function recusarModeloPendente(ministerio) {
    if (!ministerio) return { sucesso: false, mensagem: 'Ministério inválido.' };
    var all = lerModelosPendentes();
    if (!all[ministerio]) return { sucesso: false, mensagem: 'Não há modelo pendente.' };
    delete all[ministerio];
    salvarTodosModelosPendentes(all);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.registrarAtividade) {
            IBNNuvem.registrarAtividade(
                'modelo_escala_recusado',
                'Recusou formulário de escala: ' + ministerio,
                typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null
            );
        }
    } catch (e) {}
    return { sucesso: true, mensagem: 'Solicitação de modelo de ' + ministerio + ' recusada.' };
}

/**
 * Monta uma linha de escala a partir do formulário e grava.
 * dados = { ministerio, dataLabel, dataIso, preenchimento: { 'Estacionamento': ['Juarez','Napoleão'], ... }, observacao }
 */
function salvarDiaEscalaFormulario(dados) {
    if (!dados || !dados.ministerio) return { sucesso: false, mensagem: 'Ministério obrigatório' };
    var min = dados.ministerio;
    var linhas = lerEscalaCultosMinisterio(min);
    var iso = dados.dataIso || '';
    if (!iso && dados.dataLabel) {
        var pd = parseDataEscalaLabel(dados.dataLabel);
        if (pd) iso = pd.iso;
    }
    // remove dia igual se já existir
    linhas = linhas.filter(function (l) {
        return String(l.dataIso || '') !== String(iso) && String(l.dataLabel || '') !== String(dados.dataLabel || '');
    });
    var funcoes = dados.preenchimento || {};
    linhas.push({
        dataLabel: dados.dataLabel || iso,
        dataIso: iso,
        funcoes: funcoes,
        observacao: dados.observacao || '',
        ministerio: min,
        status: dados.status || 'rascunho', // rascunho | finalizada
        atualizadoEm: new Date().toISOString()
    });
    linhas.sort(function (a, b) {
        return String(a.dataIso || a.dataLabel).localeCompare(String(b.dataIso || b.dataLabel));
    });
    salvarEscalaCultosMinisterio(min, linhas);
    return { sucesso: true, mensagem: 'Escala do dia salva para ' + min, linhas: linhas };
}

/** Gera CSV do ministério (mesmo formato Atmosfera). Inclui rascunhos e finalizadas. */
function exportarEscalaCSV(ministerio) {
    var linhas = lerEscalaCultosMinisterio(ministerio) || [];
    if (!linhas.length) {
        try { alert('Nenhuma escala salva para ' + (ministerio || '') + '.\nSalve um rascunho ou finalize um dia antes de baixar.'); } catch (e) {}
        return { sucesso: false, mensagem: 'Vazio' };
    }
    var modelo = lerModeloFuncoesMinisterio(ministerio);
    // Colunas a partir do modelo + qualquer função que já exista nas linhas salvas
    var colsSet = {};
    (modelo || []).forEach(function (m) {
        if (m && m.funcao && !/^observa/i.test(m.funcao)) colsSet[m.funcao] = true;
    });
    linhas.forEach(function (l) {
        Object.keys(l.funcoes || {}).forEach(function (fn) { colsSet[fn] = true; });
    });
    var cols = ['Data'].concat(Object.keys(colsSet));
    cols.push('Observação');
    var sep = ';';
    var out = [cols.join(sep)];
    // ordena por data
    linhas = linhas.slice().sort(function (a, b) {
        return String(a.dataIso || a.dataLabel || '').localeCompare(String(b.dataIso || b.dataLabel || ''));
    });
    linhas.forEach(function (l) {
        // Data: rótulo; se rascunho, indica no texto da data para o líder ver no Excel
        var dataCell = l.dataLabel || l.dataIso || '';
        if (l.status && l.status !== 'finalizada') {
            dataCell = dataCell + ' (rascunho)';
        }
        var row = [dataCell];
        cols.slice(1).forEach(function (c) {
            if (/^observa/i.test(c)) {
                var obs = l.observacao || '';
                if (l.status && l.status !== 'finalizada' && obs.indexOf('rascunho') === -1) {
                    obs = (obs ? obs + ' | ' : '') + 'status: rascunho';
                }
                row.push(obs);
                return;
            }
            var nomes = (l.funcoes && l.funcoes[c]) ? l.funcoes[c] : [];
            row.push(Array.isArray(nomes) ? nomes.join(', ') : String(nomes || ''));
        });
        out.push(row.join(sep));
    });
    var csv = '\uFEFF' + out.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    var d = new Date();
    var ds = String(d.getDate()).padStart(2,'0') + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + d.getFullYear();
    a.download = 'escala_' + String(ministerio || 'ministerio').replace(/\s+/g, '_').toLowerCase() + '_' + ds + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { try { document.body.removeChild(a); } catch (e) {} }, 500);
    return { sucesso: true, mensagem: linhas.length + ' dia(s) no CSV (inclui rascunhos)', quantidade: linhas.length };
}


/** Cores do cartaz por ministério (estilo app Atmosfera) */
function corTemaEscalaMinisterio(ministerio) {
    var n = String(ministerio || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    var mapa = {
        'atmosfera': { header: '#1e504e', aviso: '#ecf2e8', th: '#1e504e', linha: '#f2eee4', fundo: '#faf6ef', borda: '#1e504e' },
        'acolhimento': { header: '#1a4a6e', aviso: '#e3eef8', th: '#1a4a6e', linha: '#eaf2fa', fundo: '#f5f8fc', borda: '#1a4a6e' },
        'louvor': { header: '#5a1e3a', aviso: '#f5e6ec', th: '#5a1e3a', linha: '#f8eef2', fundo: '#fcf6f8', borda: '#5a1e3a' },
        'midias sociais': { header: '#2a3a6e', aviso: '#e4e8f5', th: '#2a3a6e', linha: '#eef0f8', fundo: '#f6f7fc', borda: '#2a3a6e' },
        'midia': { header: '#2a3a6e', aviso: '#e4e8f5', th: '#2a3a6e', linha: '#eef0f8', fundo: '#f6f7fc', borda: '#2a3a6e' },
        'infantil': { header: '#c45c1a', aviso: '#fce8d8', th: '#c45c1a', linha: '#fdf0e6', fundo: '#fff8f2', borda: '#c45c1a' },
        'projeto kids': { header: '#c45c1a', aviso: '#fce8d8', th: '#c45c1a', linha: '#fdf0e6', fundo: '#fff8f2', borda: '#c45c1a' },
        'ensino': { header: '#3d5a1e', aviso: '#e8f0dc', th: '#3d5a1e', linha: '#f0f5e8', fundo: '#f8faf4', borda: '#3d5a1e' },
        'intercessao': { header: '#4a2a6e', aviso: '#ede6f5', th: '#4a2a6e', linha: '#f3eef8', fundo: '#f9f6fc', borda: '#4a2a6e' },
        'homens': { header: '#1e3a5a', aviso: '#e0eaf5', th: '#1e3a5a', linha: '#e8f0f8', fundo: '#f4f8fc', borda: '#1e3a5a' },
        'mulheres': { header: '#8b3a5c', aviso: '#f8e6ee', th: '#8b3a5c', linha: '#faf0f4', fundo: '#fdf6f9', borda: '#8b3a5c' },
        'artes': { header: '#6b4a1e', aviso: '#f5ecd8', th: '#6b4a1e', linha: '#f8f2e4', fundo: '#fcf8f0', borda: '#6b4a1e' },
        'cantina': { header: '#6a3a1a', aviso: '#f5e8d8', th: '#6a3a1a', linha: '#f8f0e6', fundo: '#fcf8f2', borda: '#6a3a1a' }
    };
    for (var k in mapa) {
        if (n.indexOf(k) >= 0) return mapa[k];
    }
    return mapa['atmosfera'];
}

/** Título do cartaz conforme data/obs (mesma lógica do app desktop) */
function tituloCartazEscala(dataLabel, observacao, ministerio) {
    var data = String(dataLabel || '');
    var upper = data.toUpperCase();
    var obs = String(observacao || '').toUpperCase();
    var diaSo = data;
    var md = data.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (md) diaSo = md[1];
    var linha1 = 'Escala — ' + (ministerio || 'Ministério');
    var isQuinta = /QUINTA/.test(upper);
    var isDom = /DOM/.test(upper);
    var isSab = /SAB|SÁB/.test(upper);
    var isCeia = /CEIA/.test(upper) || /CEIA/.test(obs);
    var isManha = /MANHA|MANHÃ/.test(upper) || /MANHA|MANHÃ/.test(obs);
    var isConf = /CONFER|CONGRESSO/.test(upper) || /CONFER|CONGRESSO/.test(obs);
    var isFestivo = /FESTIVO|FESTA/.test(upper) || /FESTIVO|FESTA/.test(obs);
    var linha2 = 'Culto Especial';
    if (isConf) linha2 = 'Conferência';
    else if (isFestivo) linha2 = 'Dia Festivo';
    else if (isQuinta) linha2 = 'Culto Fé';
    else if (isDom && isManha) linha2 = 'Culto da Manhã';
    else if (isDom && isCeia) linha2 = 'Culto de Celebração Com Ceia do Senhor';
    else if (isDom) linha2 = 'Culto de Celebração';
    else if (isSab) linha2 = 'Encontro de Sábado';
    return { linha1: linha1, linha2: linha2, linha3: 'Dia ' + diaSo };
}

/**
 * Gera PNG do cartaz da escala do dia (para WhatsApp / salvar no celular).
 * linha = objeto de escala { dataLabel, dataIso, funcoes: {fn:[nomes]}, observacao, status }
 */
function gerarCartazEscalaPng(ministerio, linha, textoForm, refForm) {
    var v = resolverVersiculoEscala('ministerio', ministerio || '', linha, textoForm, refForm);
    return gerarCartazEscalaElegante(
        'Escala de Serviço',
        ministerio || '',
        linha,
        'ministerio',
        {
            versiculo: v.texto,
            referencia: v.referencia,
            aviso: '⚠  ESTAR NO PRÉDIO DA IGREJA 30 MINUTOS ANTES  ⚠'
        }
    );
}


// ========== ESCALA DE CULTOS / SERVIÇOS (modelo Atmosfera CSV) ==========
const CHAVE_ESCALA_CULTOS = 'ibn_escala_cultos';
/** Funções padrão Atmosfera (colunas do CSV) */
const ESCALA_FUNCOES_ATMOSFERA = [
    'Balcão Inf.', 'Estacionamento', 'Saudação Festiva', 'Saudação Recepção',
    'Recepção Casal', 'Recepção Visitantes', 'Altar', 'Abertura',
    'Dízimo e Oferta', 'Máquina Cartão', 'Pregador', 'Observação'
];

function lerTodasEscalasCultos() {
    try { return JSON.parse(localStorage.getItem(CHAVE_ESCALA_CULTOS) || '{}'); }
    catch (e) { return {}; }
}
function salvarTodasEscalasCultos(obj) {
    localStorage.setItem(CHAVE_ESCALA_CULTOS, JSON.stringify(obj || {}));
}
/** Escala de um ministério: array de { dataLabel, dataIso, funcoes: { nomeFuncao: [nomes...] }, observacao } */
function lerEscalaCultosMinisterio(ministerio) {
    var all = lerTodasEscalasCultos();
    var m = all[ministerio] || all['Atmosfera'];
    return Array.isArray(m) ? m : [];
}
function salvarEscalaCultosMinisterio(ministerio, linhas) {
    var all = lerTodasEscalasCultos();
    all[ministerio || 'Atmosfera'] = linhas || [];
    salvarTodasEscalasCultos(all);
    // Nuvem: líderes/gestores no outro aparelho veem a escala
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.sincronizarEscalaMinisterio) {
            IBNNuvem.sincronizarEscalaMinisterio(ministerio || 'Atmosfera', linhas || []).then(function (r) {
                if (r && !r.sucesso && typeof avisarFalhaNuvem === 'function') {
                    avisarFalhaNuvem('Escala de ' + (ministerio || ''), r.mensagem || 'Não subiu para a nuvem');
                }
            }).catch(function (e) {
                if (typeof avisarFalhaNuvem === 'function') {
                    avisarFalhaNuvem('Escala de ' + (ministerio || ''), (e && e.message) || String(e));
                }
            });
        }
    } catch (e) {}
}

/** Converte "DOM 13/09/26" ou "QUINTA 17/09/26" em Date / ISO */
function parseDataEscalaLabel(label) {
    var s = String(label || '').trim();
    var m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) return null;
    var dd = parseInt(m[1], 10);
    var mm = parseInt(m[2], 10) - 1;
    var aa = parseInt(m[3], 10);
    if (aa < 100) aa += 2000;
    var d = new Date(aa, mm, dd, 12, 0, 0);
    if (isNaN(d.getTime())) return null;
    var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return { date: d, iso: iso, label: s };
}

/** Parte nomes: "Juarez, Juscelio e Napoleão" → lista */
function parseNomesEscala(celula) {
    var s = String(celula || '').trim();
    if (!s) return [];
    s = s.replace(/\s+e\s+/gi, ',').replace(/\s+&\s+/g, ',');
    return s.split(/[,;/|]+/).map(function (x) { return x.trim(); }).filter(Boolean);
}

/**
 * Importa CSV no formato Atmosfera (separador ;).
 * Retorna { sucesso, quantidade, linhas, mensagem }
 */
function importarEscalaCSV(textoCSV, ministerio) {
    ministerio = ministerio || 'Atmosfera';
    if (!textoCSV || !String(textoCSV).trim()) {
        return { sucesso: false, mensagem: 'Arquivo vazio.' };
    }
    var texto = String(textoCSV).replace(/^\uFEFF/, '');
    var linhasBrutas = texto.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (linhasBrutas.length < 2) {
        return { sucesso: false, mensagem: 'CSV precisa de cabeçalho e pelo menos uma linha.' };
    }
    var sep = linhasBrutas[0].indexOf(';') >= 0 ? ';' : ',';
    var header = linhasBrutas[0].split(sep).map(function (h) { return h.trim(); });
    var idxData = 0;
    var funcoesCols = [];
    header.forEach(function (h, i) {
        if (i === 0 || /^data$/i.test(h)) { idxData = i; return; }
        if (/observa/i.test(h)) return;
        funcoesCols.push({ i: i, nome: h });
    });
    var idxObs = header.findIndex(function (h) { return /observa/i.test(h); });
    var linhas = [];
    for (var r = 1; r < linhasBrutas.length; r++) {
        var cols = linhasBrutas[r].split(sep);
        var dataLabel = (cols[idxData] || '').trim();
        if (!dataLabel) continue;
        var pd = parseDataEscalaLabel(dataLabel);
        var funcoes = {};
        funcoesCols.forEach(function (fc) {
            var nomes = parseNomesEscala(cols[fc.i] || '');
            if (nomes.length) funcoes[fc.nome] = nomes;
        });
        linhas.push({
            dataLabel: dataLabel,
            dataIso: pd ? pd.iso : '',
            funcoes: funcoes,
            observacao: idxObs >= 0 ? String(cols[idxObs] || '').trim() : '',
            ministerio: ministerio
        });
    }
    // ordena por data
    linhas.sort(function (a, b) {
        return String(a.dataIso || a.dataLabel).localeCompare(String(b.dataIso || b.dataLabel));
    });
    salvarEscalaCultosMinisterio(ministerio, linhas);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.registrarAtividade) {
            IBNNuvem.registrarAtividade('escala_csv', 'Importou escala ' + ministerio + ' (' + linhas.length + ' dias)', getUsuarioLogado());
        }
    } catch (e) {}
    return { sucesso: true, quantidade: linhas.length, linhas: linhas, mensagem: linhas.length + ' dia(s) importados para ' + ministerio };
}

/** Nome do membro parece estar na lista da escala? */
function nomeBateEscala(nomeCompleto, nomeNaEscala) {
    var full = String(nomeCompleto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    var part = String(nomeNaEscala || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (!full || !part) return false;
    if (full === part) return true;
    var partesFull = full.split(/\s+/);
    var partesE = part.split(/\s+/);
    // primeiro nome
    if (partesFull[0] && partesE[0] && partesFull[0] === partesE[0]) {
        // se escala tem só primeiro nome, ok; se tem sobrenome, exige coincidência parcial
        if (partesE.length === 1) return true;
        return partesE.every(function (pe) {
            return partesFull.some(function (pf) { return pf.indexOf(pe) === 0 || pe.indexOf(pf) === 0; });
        });
    }
    // contém
    if (full.indexOf(part) !== -1 || part.indexOf(partesFull[0]) !== -1) return true;
    return false;
}

/**
 * Próximos compromissos do membro na escala (hoje e amanhã prioridade).
 * Retorna [{ dataLabel, dataIso, diasAte, funcoes: [nomeFuncao], ministerio, observacao }]
 */
function escalaProximasDoMembro(membro, horizonteDias) {
    horizonteDias = horizonteDias == null ? 14 : horizonteDias;
    membro = membro || (typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null);
    if (!membro || !membro.nome) return [];
    var hoje = new Date();
    hoje.setHours(12, 0, 0, 0);
    var all = lerTodasEscalasCultos();
    var out = [];
    Object.keys(all).forEach(function (min) {
        (all[min] || []).forEach(function (linha) {
            if (!linha.dataIso) return;
            var d = new Date(linha.dataIso + 'T12:00:00');
            if (isNaN(d.getTime())) return;
            var diff = Math.round((d - hoje) / 86400000);
            if (diff < 0 || diff > horizonteDias) return;
            var funcoesHit = [];
            var funcoes = linha.funcoes || {};
            Object.keys(funcoes).forEach(function (fn) {
                (funcoes[fn] || []).forEach(function (nomeE) {
                    if (nomeBateEscala(membro.nome, nomeE)) funcoesHit.push(fn);
                });
            });
            if (!funcoesHit.length) return;
            // unique
            funcoesHit = funcoesHit.filter(function (v, i, a) { return a.indexOf(v) === i; });
            out.push({
                dataLabel: linha.dataLabel,
                dataIso: linha.dataIso,
                diasAte: diff,
                funcoes: funcoesHit,
                ministerio: min,
                observacao: linha.observacao || ''
            });
        });
    });
    out.sort(function (a, b) { return a.diasAte - b.diasAte; });
    return out;
}

/** Horário padrão do culto para lembretes (pode ajustar) */
var ESCALA_HORARIO_CULTO_PADRAO = '19:00';

function escalaDataHoraCulto(dataIso, horario) {
    horario = horario || ESCALA_HORARIO_CULTO_PADRAO;
    var hm = String(horario).split(':');
    var h = parseInt(hm[0], 10) || 19;
    var mi = parseInt(hm[1], 10) || 0;
    return new Date(dataIso + 'T' + String(h).padStart(2,'0') + ':' + String(mi).padStart(2,'0') + ':00');
}

/**
 * Avisos prioritários no site (logado):
 * - até 45 dias: lista completa disponível
 * - 36h antes e no dia: banner
 * - 4h antes: banner urgente
 */
function escalaAvisosUrgentes(membro) {
    membro = membro || (typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null);
    var lista = escalaProximasDoMembro(membro, 3);
    var agora = new Date();
    return lista.filter(function (x) {
        if (x.diasAte > 2) return false;
        var culto = escalaDataHoraCulto(x.dataIso);
        var horas = (culto - agora) / 3600000;
        // janela: 36h antes até o culto (e um pouco depois no mesmo dia)
        return horas <= 36 && horas >= -2;
    }).map(function (x) {
        var culto = escalaDataHoraCulto(x.dataIso);
        var horas = (culto - agora) / 3600000;
        x.horasAte = Math.round(horas * 10) / 10;
        x.urgente4h = horas <= 4 && horas >= 0;
        x.janela36h = horas <= 36 && horas > 4;
        return x;
    });
}

function textoLembreteEscala(membro, item) {
    var nome = (membro && membro.nome) ? String(membro.nome).split(' ')[0] : 'irmão(ã)';
    var funcoes = (item.funcoes || []).join(', ') || 'sua função';
    var min = item.ministerio || 'IBN';
    var quando = item.diasAte === 0 ? 'hoje' : (item.diasAte === 1 ? 'amanhã' : (item.dataLabel || item.dataIso));
    var obs = item.observacao ? ' (' + item.observacao + ')' : '';
    return 'Olá, ' + nome + '! Lembrete IBN Diamantino.\n\n' +
        'Você está na escala ' + quando + ' — ministério *' + min + '*.\n' +
        'Função: *' + funcoes + '*' + obs + '.\n\n' +
        'Por favor, esteja na igreja *30 minutos antes*.\n' +
        'Deus abençoe! 🙏';
}

function telefoneWhatsAppBR(tel) {
    var d = String(tel || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length <= 11 && d.charAt(0) !== '5') d = '55' + d;
    return d;
}

function linkWhatsAppEscala(telefone, texto) {
    var d = telefoneWhatsAppBR(telefone);
    if (!d) return '';
    return 'https://wa.me/' + d + '?text=' + encodeURIComponent(texto || '');
}

/** Monta lista de lembretes WhatsApp para um dia/ministério (secretaria envia) */
function montarLembretesWhatsAppEscala(ministerio, dataIso) {
    var linhas = lerEscalaCultosMinisterio(ministerio);
    var linha = (linhas || []).find(function (l) { return String(l.dataIso) === String(dataIso); });
    if (!linha) return [];
    var membros = (typeof membrosReais === 'function') ? membrosReais() : lerMembros();
    var out = [];
    var funcoes = linha.funcoes || {};
    Object.keys(funcoes).forEach(function (fn) {
        (funcoes[fn] || []).forEach(function (nomeE) {
            var m = (membros || []).find(function (p) { return nomeBateEscala(p.nome, nomeE); });
            var item = {
                dataLabel: linha.dataLabel,
                dataIso: linha.dataIso,
                diasAte: 0,
                funcoes: [fn],
                ministerio: ministerio,
                observacao: linha.observacao || ''
            };
            var texto = textoLembreteEscala(m || { nome: nomeE }, item);
            var tel = m ? m.telefone : '';
            out.push({
                nome: m ? m.nome : nomeE,
                telefone: tel,
                funcao: fn,
                texto: texto,
                link: linkWhatsAppEscala(tel, texto)
            });
        });
    });
    return out;
}

/** Escala completa do ministério nos próximos N dias (padrão 45) */
function escalaCompletaMinisterio(ministerio, horizonteDias) {
    horizonteDias = horizonteDias == null ? 120 : horizonteDias;
    var hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    var linhas = lerEscalaCultosMinisterio(ministerio) || [];
    return linhas.filter(function (l) {
        if (!l.dataIso) return true;
        var d = new Date(l.dataIso + 'T12:00:00');
        var diff = Math.round((d - hoje) / 86400000);
        return diff >= -1 && diff <= horizonteDias;
    }).sort(function (a, b) {
        return String(a.dataIso || '').localeCompare(String(b.dataIso || ''));
    });
}

function removerDiaEscala(ministerio, dataIso) {
    var linhas = lerEscalaCultosMinisterio(ministerio) || [];
    linhas = linhas.filter(function (l) { return String(l.dataIso) !== String(dataIso); });
    salvarEscalaCultosMinisterio(ministerio, linhas);
    return { sucesso: true };
}



// ========== CONFIRMAÇÃO DE ESCALA (membro confirma; líder acompanha) ==========
const CHAVE_CONFIRMA_ESCALA = 'ibn_escala_confirmacoes';

function lerConfirmacoesEscala() {
    try { return JSON.parse(localStorage.getItem(CHAVE_CONFIRMA_ESCALA) || '{}'); }
    catch (e) { return {}; }
}
function salvarConfirmacoesEscala(obj) {
    localStorage.setItem(CHAVE_CONFIRMA_ESCALA, JSON.stringify(obj || {}));
}
/** chave única: ministerio|dataIso|membroId */
function chaveConfirmacaoEscala(ministerio, dataIso, membroId) {
    return String(ministerio || '') + '|' + String(dataIso || '') + '|' + String(membroId || '');
}

// ========== NOTIFICAÇÕES PUSH / LOCAIS (escala) ==========
function statusPermissaoNotificacao() {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission; // granted | denied | default
}

/** Pede permissão e grava no cadastro do membro (granted/denied/default) */
async function pedirPermissaoNotificacoes(membro) {
    membro = membro || (typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null);
    if (!membro || !membro.id) return { sucesso: false, permissao: 'default' };
    if (typeof Notification === 'undefined') {
        gravarPermissaoNotifMembro(membro.id, 'unsupported');
        return { sucesso: false, permissao: 'unsupported' };
    }
    try {
        var perm = Notification.permission;
        if (perm === 'default') {
            perm = await Notification.requestPermission();
        }
        gravarPermissaoNotifMembro(membro.id, perm);
        // registra SW se ainda não
        try {
            if ('serviceWorker' in navigator) {
                await navigator.serviceWorker.register('sw.js');
            }
        } catch (e) {}
        return { sucesso: perm === 'granted', permissao: perm };
    } catch (e) {
        gravarPermissaoNotifMembro(membro.id, 'denied');
        return { sucesso: false, permissao: 'denied', mensagem: String(e) };
    }
}

function gravarPermissaoNotifMembro(membroId, permissao) {
    try {
        var lista = (typeof lerMembros === 'function') ? lerMembros() : [];
        var idx = lista.findIndex(function (m) { return String(m.id) === String(membroId); });
        if (idx === -1) return;
        lista[idx].notifPermission = permissao;
        lista[idx].notifAtualizadoEm = new Date().toISOString();
        if (typeof salvarMembros === 'function') salvarMembros(lista);
        else localStorage.setItem('ibn_membros', JSON.stringify(lista));
        // atualiza sessão
        try {
            var u = (typeof getUsuarioLogado === 'function') ? getUsuarioLogado() : null;
            if (u && String(u.id) === String(membroId) && typeof iniciarSessao === 'function') {
                u.notifPermission = permissao;
                iniciarSessao(u);
            }
        } catch (e) {}
        try {
            if (typeof IBNNuvem !== 'undefined' && IBNNuvem.sincronizarUmMembro) {
                IBNNuvem.sincronizarUmMembro(lista[idx]);
            }
        } catch (e) {}
    } catch (e) {}
}

/**
 * Mostra notificação local (aparelho).
 * Funciona se permission=granted; com site aberto ou via service worker.
 */
async function mostrarNotificacaoEscala(titulo, corpo, tag) {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission !== 'granted') return false;
    try {
        if ('serviceWorker' in navigator) {
            var reg = await navigator.serviceWorker.ready;
            if (reg && reg.active) {
                reg.active.postMessage({
                    type: 'MOSTRAR_NOTIFICACAO',
                    titulo: titulo || 'IBN Diamantino',
                    corpo: corpo || '',
                    tag: tag || 'ibn-escala',
                    url: './index.html',
                    requireInteraction: true
                });
                // fallback direto no registration
                await reg.showNotification(titulo || 'IBN Diamantino', {
                    body: corpo || '',
                    tag: tag || 'ibn-escala',
                    data: { url: './index.html' },
                    requireInteraction: true
                });
                return true;
            }
        }
        new Notification(titulo || 'IBN Diamantino', { body: corpo || '', tag: tag || 'ibn-escala' });
        return true;
    } catch (e) {
        try {
            new Notification(titulo || 'IBN Diamantino', { body: corpo || '' });
            return true;
        } catch (e2) { return false; }
    }
}

/** Ao abrir o site logado: pede permissão (1x) e dispara notif se escala em 36h */
async function processarNotificacoesEscalaAoAbrir() {
    var u = (typeof getUsuarioLogado === 'function') ? getUsuarioLogado() : null;
    if (!u || !u.id) return;
    // pede permissão só se ainda default
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        // não força na hora do login agressivo — só se já tem escala próxima
        var avisosPre = (typeof escalaAvisosUrgentes === 'function') ? escalaAvisosUrgentes(u) : [];
        if (avisosPre.length) {
            await pedirPermissaoNotificacoes(u);
        }
    } else if (typeof Notification !== 'undefined') {
        gravarPermissaoNotifMembro(u.id, Notification.permission);
    }
    var avisos = (typeof escalaAvisosUrgentes === 'function') ? escalaAvisosUrgentes(u) : [];
    if (!avisos.length) return;
    var a = avisos[0];
    var chave = 'ibn_push_escala_' + a.dataIso + '_' + u.id;
    try {
        if (sessionStorage.getItem(chave)) return; // já mostrou nesta sessão
        sessionStorage.setItem(chave, '1');
    } catch (e) {}
    var funcoes = (a.funcoes || []).join(', ');
    var corpo = 'Você está na escala ' + (a.diasAte === 0 ? 'HOJE' : 'em breve') +
        ' (' + (a.dataLabel || '') + '): ' + funcoes +
        (a.ministerio ? ' — ' + a.ministerio : '') +
        '. Esteja 30 minutos antes na igreja. Abra o site e confirme que recebeu.';
    await mostrarNotificacaoEscala('📋 Escala IBN Diamantino', corpo, 'escala-' + a.dataIso);
}


function confirmarRecebimentoEscala(ministerio, dataIso, membro) {
    membro = membro || (typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null);
    if (!membro || !membro.id) return { sucesso: false, mensagem: 'Faça login.' };
    var all = lerConfirmacoesEscala();
    var k = chaveConfirmacaoEscala(ministerio, dataIso, membro.id);
    all[k] = {
        membroId: membro.id,
        nome: membro.nome,
        ministerio: ministerio,
        dataIso: dataIso,
        confirmadoEm: new Date().toISOString(),
        aparelho: (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent.slice(0, 80) : ''
    };
    salvarConfirmacoesEscala(all);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.registrarAtividade) {
            IBNNuvem.registrarAtividade('escala_confirmou', 'Confirmou escala ' + ministerio + ' ' + dataIso, membro);
        }
    } catch (e) {}
    return { sucesso: true, mensagem: 'Confirmação registrada. Obrigado!' };
}
function membroConfirmouEscala(ministerio, dataIso, membroId) {
    var all = lerConfirmacoesEscala();
    return !!all[chaveConfirmacaoEscala(ministerio, dataIso, membroId)];
}

/**
 * Lista de escalados para o líder nas próximas 36h (com telefone, WA, confirmação).
 * Retorna [{ nome, telefone, funcao, ministerio, dataIso, dataLabel, confirmou, linkWa, linkTel }]
 */
function listaEscaladosJanela36h(ministerioFiltro) {
    var agora = new Date();
    var all = lerTodasEscalasCultos();
    var membros = (typeof membrosReais === 'function') ? membrosReais() : (typeof lerMembros === 'function' ? lerMembros() : []);
    var out = [];
    Object.keys(all).forEach(function (min) {
        if (ministerioFiltro && String(min).toLowerCase() !== String(ministerioFiltro).toLowerCase()) return;
        (all[min] || []).forEach(function (linha) {
            if (!linha.dataIso) return;
            var culto = (typeof escalaDataHoraCulto === 'function')
                ? escalaDataHoraCulto(linha.dataIso)
                : new Date(linha.dataIso + 'T19:00:00');
            var horas = (culto - agora) / 3600000;
            if (horas > 36 || horas < -1) return;
            var funcoes = linha.funcoes || {};
            Object.keys(funcoes).forEach(function (fn) {
                (funcoes[fn] || []).forEach(function (nomeE) {
                    var m = (membros || []).find(function (p) {
                        return typeof nomeBateEscala === 'function' && nomeBateEscala(p.nome, nomeE);
                    });
                    var item = {
                        dataLabel: linha.dataLabel,
                        dataIso: linha.dataIso,
                        funcoes: [fn],
                        ministerio: min,
                        observacao: linha.observacao || ''
                    };
                    var texto = (typeof textoLembreteEscala === 'function')
                        ? textoLembreteEscala(m || { nome: nomeE }, item)
                        : ('Lembrete IBN Diamantino — escala ' + min);
                    var tel = m ? (m.telefone || '') : '';
                    var mid = m ? m.id : '';
                    var nPerm = m ? (m.notifPermission || 'default') : 'default';
                    out.push({
                        nome: m ? m.nome : nomeE,
                        membroId: mid,
                        telefone: tel,
                        funcao: fn,
                        ministerio: min,
                        dataIso: linha.dataIso,
                        dataLabel: linha.dataLabel,
                        horasAte: Math.round(horas * 10) / 10,
                        confirmou: mid ? membroConfirmouEscala(min, linha.dataIso, mid) : false,
                        notifPermission: nPerm,
                        notifLabel: nPerm === 'granted' ? '🔔 Notif. OK' : (nPerm === 'denied' ? '🔕 Bloqueou notif.' : '⏳ Sem permissão'),
                        linkWa: (typeof linkWhatsAppEscala === 'function') ? linkWhatsAppEscala(tel, texto) : '',
                        linkTel: tel ? ('tel:' + String(tel).replace(/\D/g, '')) : '',
                        texto: texto
                    });
                });
            });
        });
    });
    out.sort(function (a, b) {
        if (a.dataIso !== b.dataIso) return String(a.dataIso).localeCompare(String(b.dataIso));
        return String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    });
    return out;
}


// Compat: escala simples antiga (lista manual)
function lerEscalaMinisterio(nomeMinisterio) {
    try {
        var all = JSON.parse(localStorage.getItem('ibn_escala_ministerios') || '{}');
        return Array.isArray(all[nomeMinisterio]) ? all[nomeMinisterio] : [];
    } catch (e) { return []; }
}
function salvarEscalaMinisterio(nomeMinisterio, itens) {
    try {
        var all = JSON.parse(localStorage.getItem('ibn_escala_ministerios') || '{}');
        all[nomeMinisterio] = itens || [];
        localStorage.setItem('ibn_escala_ministerios', JSON.stringify(all));
    } catch (e) {}
}
function escalaDoMembroNoMinisterio(membroId, nomeMinisterio) {
    return lerEscalaMinisterio(nomeMinisterio).filter(function (x) {
        return String(x.membroId) === String(membroId);
    });
}




/** Membros de um ministério (nome como no cadastro, ex.: Atmosfera) */


/** Remove duplicatas locais pela regra nome+nascimento (mantém o cadastro mais completo/recente) */
function deduplicarMembrosLocais() {
    const lista = lerMembros();
    const porChave = {};
    const semChave = [];
    lista.forEach(function (m) {
        const k = chaveIdentidadePessoa(m.nome, m.nascimento);
        if (!k) { semChave.push(m); return; }
        if (!porChave[k]) {
            porChave[k] = m;
            return;
        }
        // Mantém o que tem mais dados / id mais antigo como principal e mescla e-mails
        const atual = porChave[k];
        const rankN = function (n) {
            n = String((n && n.nivel) || '').toLowerCase();
            if (n === 'gestor') return 3;
            if (n === 'admin') return 2;
            return 1;
        };
        var prefer = (m.dataCadastro || '') > (atual.dataCadastro || '') ? m : atual;
        // Se um é admin/gestor, esse prevalece no nível
        if (rankN(m) > rankN(prefer)) prefer = m;
        if (rankN(atual) > rankN(prefer)) prefer = atual;
        const outro = prefer === m ? atual : m;
        prefer.telefone = prefer.telefone || outro.telefone;
        prefer.email = prefer.email || outro.email;
        prefer.endereco = prefer.endereco || outro.endereco;
        prefer.municipio = prefer.municipio || outro.municipio;
        if ((!prefer.celulas || !prefer.celulas.length) && outro.celulas) prefer.celulas = outro.celulas;
        if ((!prefer.ministerios || !prefer.ministerios.length) && outro.ministerios) prefer.ministerios = outro.ministerios;
        if (rankN(outro) > rankN(prefer)) {
            prefer.nivel = outro.nivel;
            prefer.cargo = outro.cargo || prefer.cargo;
        } else if (rankN(outro) === rankN(prefer) && rankN(prefer) >= 2) {
            prefer.cargo = prefer.cargo || outro.cargo;
        }
        porChave[k] = prefer;
    });
    const nova = semChave.concat(Object.keys(porChave).map(function (k) { return porChave[k]; }));
    salvarMembros(nova);
    return nova;
}


/** Lista normalizada dos ministérios que a pessoa LIDER (não só participa) */
function normalizarNomeMinisterio(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function nomesMinisterioIguais(a, b) {
    var x = normalizarNomeMinisterio(a);
    var y = normalizarNomeMinisterio(b);
    if (!x || !y) return false;
    if (x === y) return true;
    // abreviações comuns
    if (x.indexOf(y) !== -1 || y.indexOf(x) !== -1) return true;
    // "midias" ↔ "midias sociais"
    if (x.replace(/\s/g,'') === y.replace(/\s/g,'')) return true;
    return false;
}
function ministeriosQueLidera(m) {
    if (!m) return [];
    var out = [];
    function add(s) {
        s = String(s || '').trim();
        if (!s) return;
        // evita duplicar equivalentes
        if (out.some(function (x) { return nomesMinisterioIguais(x, s); })) return;
        out.push(s);
    }
    if (Array.isArray(m.lideraMinisterios)) {
        m.lideraMinisterios.forEach(add);
    }
    if (m.lideraMinisterio) {
        String(m.lideraMinisterio).split(/[,;/|]+/).forEach(add);
    }
    // Fallback: função específica tipo "Líder de Louvor" / "Líder da Mídia"
    var fe = String(m.funcaoEspecifica || '');
    if (/l[ií]der/i.test(fe) && typeof LISTA_MINISTERIOS !== 'undefined') {
        LISTA_MINISTERIOS.forEach(function (nome) {
            var n = normalizarNomeMinisterio(nome);
            var f = normalizarNomeMinisterio(fe);
            // "lider da midia" → Mídias Sociais
            if (f.indexOf(n) !== -1) add(nome);
            if (n.indexOf('midia') !== -1 && (f.indexOf('midia') !== -1 || f.indexOf('media') !== -1)) add(nome);
        });
    }
    return out;
}
/** True se lidera ESTE ministério específico (cadastro) */
function lideraEsteMinisterio(m, nomeMinisterio) {
    if (!m || !nomeMinisterio) return false;
    return ministeriosQueLidera(m).some(function (x) {
        return nomesMinisterioIguais(x, nomeMinisterio);
    });
}
/** True se participa (lista ministerios) deste ministério */
function participaDesteMinisterio(m, nomeMinisterio) {
    if (!m || !nomeMinisterio) return false;
    var mins = Array.isArray(m.ministerios) ? m.ministerios : [];
    if (!mins.length && m.ministerios) mins = String(m.ministerios).split(/[,;/|]+/);
    // quem lidera também "participa"
    if (lideraEsteMinisterio(m, nomeMinisterio)) return true;
    return mins.some(function (x) {
        return nomesMinisterioIguais(x, nomeMinisterio);
    });
}

function membrosDoMinisterio(nomeMinisterio) {
    const alvoNome = String(nomeMinisterio || '').trim();
    const alvo = alvoNome.toLowerCase();
    if (!alvo) return [];
    const lista = (typeof membrosReais === 'function' ? membrosReais() : lerMembros()).filter(function (m) {
        if (typeof isContaSistema === 'function' && isContaSistema(m)) return false;
        const st = (m.status || 'aprovado').toLowerCase();
        return st !== 'rejeitado' && st !== 'recusado' && st !== 'excluido';
    });
    // Entra se PARTICIPA ou se LIDERA este ministério (pelo cadastro de alocação)
    return lista.filter(function (m) {
        return participaDesteMinisterio(m, alvoNome) || lideraEsteMinisterio(m, alvoNome);
    }).map(function (m) {
        // Papel só pelo cadastro: lideraMinisterios / lideraMinisterio — NÃO pelo cargo genérico
        var papel = lideraEsteMinisterio(m, alvoNome) ? 'Líder' : 'Integrante';
        if (m.status === 'pendente' || m.status === 'aguardando') papel += ' (pendente)';
        return Object.assign({}, m, { papel: papel });
    }).sort(function (a, b) {
        if (String(a.papel).indexOf('Líder') === 0 && String(b.papel).indexOf('Líder') !== 0) return -1;
        if (String(b.papel).indexOf('Líder') === 0 && String(a.papel).indexOf('Líder') !== 0) return 1;
        return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
    });
}

/** Papéis na célula — respeita alocação (papeis / lideraCelulaId), não só cargo genérico */
function papeisNaCelula(m, celulaId) {
    if (!m || !celulaId) return [];
    var out = [];
    var celulas = Array.isArray(m.celulas) ? m.celulas : [];
    celulas.forEach(function (c) {
        var id = (typeof idCelulaDe === 'function') ? idCelulaDe(c) : (c && c.id);
        if (String(id) !== String(celulaId)) return;
        var pp = Array.isArray(c.papeis) ? c.papeis : String(c.papel || '').split(/[,;/]+/);
        pp.forEach(function (p) {
            p = String(p || '').trim().toLowerCase();
            if (p && out.indexOf(p) === -1) out.push(p);
        });
    });
    if (m.lideraCelulaId && String(m.lideraCelulaId) === String(celulaId)) {
        if (out.indexOf('lider') === -1) out.push('lider');
    }
    if (Array.isArray(m.funcoes)) {
        if (m.funcoes.indexOf('anfitriao') !== -1 && out.indexOf('anfitriao') === -1) {
            // só se estiver nesta célula
            var nesta = celulas.some(function (c) {
                var id = (typeof idCelulaDe === 'function') ? idCelulaDe(c) : (c && c.id);
                return String(id) === String(celulaId);
            });
            if (nesta) out.push('anfitriao');
        }
    }
    return out;
}
function equipeDaCelula(celulaId) {
    const membros = membrosDaCelula(celulaId);
    const todos = (typeof membrosReais === 'function' ? membrosReais() : lerMembros()).filter(function (m) {
        if (typeof isContaSistema === 'function' && isContaSistema(m)) return false;
        const st = (m.status || 'aprovado').toLowerCase();
        return st !== 'rejeitado' && st !== 'recusado';
    });
    function temPapel(m, papel) {
        var pp = papeisNaCelula(m, celulaId);
        if (pp.indexOf(papel) !== -1) return true;
        if (papel === 'lider' && m.lideraCelulaId && String(m.lideraCelulaId) === String(celulaId)) return true;
        return false;
    }
    // Líder: prioridade alocação nesta célula
    var lider = membros.find(function (m) { return temPapel(m, 'lider'); })
        || todos.find(function (m) { return temPapel(m, 'lider'); })
        || null;
    var anfitriao = membros.find(function (m) { return temPapel(m, 'anfitriao'); })
        || membros.find(function (m) {
            return (m.funcaoEspecifica || '').toLowerCase().indexOf('anfitri') !== -1
                && membros.some(function (x) { return x.id === m.id; });
        }) || null;
    var lideresTreino = membros.filter(function (m) {
        return temPapel(m, 'lider_treino')
            || m.cargo === 'Líder em treinamento'
            || (m.funcaoEspecifica || '').toLowerCase().indexOf('treinament') !== -1;
    });
    // compat: liderTreino = primeiro (ou null)
    var liderTreino = lideresTreino[0] || null;
    return { lider: lider, anfitriao: anfitriao, liderTreino: liderTreino, lideresTreino: lideresTreino, membros: membros };
}


/** Adiciona membro já cadastrado a uma célula (líder/admin/gestor) */

/** Indicadores de conformidade — células e ministérios */
function _membroPendente(m) {
    if (!m) return false;
    return m.status === 'pendente' || m.status === 'aguardando' || m.statusAprovacao === 'pendente';
}
function statusPendenciasCelula(celulaId) {
    var eq = (typeof equipeDaCelula === 'function') ? equipeDaCelula(celulaId) : { lider: null, anfitriao: null, liderTreino: null, membros: [] };
    var nivel = 0; // 0 ok, 1 alerta (laranja), 2 critico (vermelho), azul relatório separado
    var motivos = [];
    if (!eq.lider) {
        nivel = Math.max(nivel, 2);
        motivos.push('Vermelho: sem membro cadastrado como líder de célula');
    } else if (_membroPendente(eq.lider)) {
        nivel = Math.max(nivel, 1);
        motivos.push('Líder aguardando aprovação');
    }
    // Anfitrião: se não tem e não é célula de sábado na igreja, sinaliza
    if (!eq.anfitriao) {
        // cargo vago — vermelho se também sem líder já é 2; senão vermelho para anfitrião
        nivel = Math.max(nivel, 2);
        motivos.push('Vermelho: sem membro cadastrado como anfitrião');
    } else if (_membroPendente(eq.anfitriao)) {
        nivel = Math.max(nivel, 1);
        motivos.push('Anfitrião aguardando aprovação');
    }
    // Membros pendentes na célula
    var pend = (eq.membros || []).filter(_membroPendente);
    if (pend.length) {
        nivel = Math.max(nivel, 1);
        motivos.push(pend.length + ' membro(s) pendente(s)');
    }
    // Relatório da última reunião esperada
    var faltaRelatorio = false;
    try {
        var cel = (typeof LISTA_CELULAS !== 'undefined') ? LISTA_CELULAS.find(function(c){ return c.id === celulaId; }) : null;
        var diaSemana = cel && cel.dia === 'sabado' ? 6 : 2; // 2=terça, 6=sábado
        var hoje = new Date();
        // última data desse dia da semana (não futuro)
        var d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
        while (d.getDay() !== diaSemana) d.setDate(d.getDate() - 1);
        // se ainda é "hoje" e antes do horário típico da célula, usa semana anterior
        if (d.toDateString() === hoje.toDateString() && hoje.getHours() < 20) {
            d.setDate(d.getDate() - 7);
        }
        var iso = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        var br = String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
        var rels = (typeof lerRelatoriosCelula === 'function') ? lerRelatoriosCelula() : [];
        var tem = rels.some(function(r) {
            if (String(r.celulaId) !== String(celulaId)) return false;
            var rd = String(r.data || '');
            return rd.indexOf(iso) === 0 || rd.indexOf(br) === 0 || rd === iso || rd === br;
        });
        // também aceita relatório nos últimos 10 dias
        if (!tem) {
            var limite = new Date(hoje.getTime() - 10 * 24 * 60 * 60 * 1000);
            tem = rels.some(function(r) {
                if (String(r.celulaId) !== String(celulaId)) return false;
                var rd = String(r.data || '');
                var parsed = null;
                if (/^\d{4}-\d{2}-\d{2}/.test(rd)) parsed = new Date(rd.slice(0,10) + 'T12:00:00');
                else if (/^\d{2}\/\d{2}\/\d{4}/.test(rd)) {
                    var p = rd.slice(0,10).split('/');
                    parsed = new Date(p[2] + '-' + p[1] + '-' + p[0] + 'T12:00:00');
                }
                return parsed && !isNaN(parsed.getTime()) && parsed >= limite;
            });
        }
        if (!tem) {
            faltaRelatorio = true;
            motivos.push('Sem relatório recente');
        }
    } catch (e) {}

    var cor = null; // null = sem indicador
    if (nivel >= 2) cor = 'vermelho';
    else if (nivel >= 1) cor = 'laranja';
    if (faltaRelatorio && !cor) cor = 'azul';
    else if (faltaRelatorio && cor === 'laranja') { /* mantém laranja + motivo relatório */ }
    else if (faltaRelatorio && cor === 'vermelho') { /* mantém */ }

    return { cor: cor, motivos: motivos, faltaRelatorio: faltaRelatorio, nivel: nivel };
}

function statusPendenciasMinisterio(nomeMinisterio) {
    var nome = String(nomeMinisterio || '').trim();
    if (!nome) return { cor: null, motivos: [] };
    var lista = (typeof membrosReais === 'function') ? membrosReais() : ((typeof lerMembros === 'function') ? lerMembros() : []);
    lista = (lista || []).filter(function (m) {
        if (typeof isContaSistema === 'function' && isContaSistema(m)) return false;
        var st = (m.status || 'aprovado').toLowerCase();
        return st !== 'rejeitado' && st !== 'recusado' && st !== 'excluido';
    });
    function noMin(m) {
        return participaDesteMinisterio(m, nome);
    }
    function ehLiderMin(m) {
        return lideraEsteMinisterio(m, nome);
    }
    var lideres = lista.filter(ehLiderMin);
    var membrosMin = lista.filter(noMin);
    var motivos = [];
    var nivel = 0;
    if (!lideres.length) {
        nivel = 2;
        if (membrosMin.length) {
            motivos.push('Sem líder cadastrado (há ' + membrosMin.length + ' integrante(s) — marque em "Ministérios que lidera")');
        } else {
            motivos.push('Vermelho: sem membro cadastrado como líder deste ministério');
        }
    } else if (lideres.some(_membroPendente)) {
        nivel = Math.max(nivel, 1);
        motivos.push('Líder aguardando aprovação');
    }
    var pend = membrosMin.filter(_membroPendente);
    if (pend.length) {
        nivel = Math.max(nivel, 1);
        motivos.push(pend.length + ' membro(s) pendente(s)');
    }
    var cor = null;
    if (nivel >= 2) cor = 'vermelho';
    else if (nivel >= 1) cor = 'laranja';
    return { cor: cor, motivos: motivos, nivel: nivel, lideres: lideres.map(function(x){ return x.nome; }), qtdMembros: membrosMin.length };
}


/** Resumo para painel admin/gestor — indicadores gerais */
function resumoPendenciasGestao() {
    var celulas = [];
    var ministerios = [];
    var nVermelho = 0, nLaranja = 0, nAzul = 0;
    if (typeof LISTA_CELULAS !== 'undefined') {
        LISTA_CELULAS.forEach(function (c) {
            var st = statusPendenciasCelula(c.id);
            if (!st || !st.cor) return;
            celulas.push({ id: c.id, nome: c.nome, cor: st.cor, motivos: st.motivos || [] });
            if (st.cor === 'vermelho') nVermelho++;
            else if (st.cor === 'laranja') nLaranja++;
            else if (st.cor === 'azul') nAzul++;
        });
    }
    if (typeof LISTA_MINISTERIOS !== 'undefined') {
        LISTA_MINISTERIOS.forEach(function (nome) {
            var st = statusPendenciasMinisterio(nome);
            if (!st || !st.cor) return;
            ministerios.push({ nome: nome, cor: st.cor, motivos: st.motivos || [] });
            if (st.cor === 'vermelho') nVermelho++;
            else if (st.cor === 'laranja') nLaranja++;
        });
    }
    // Membros com status pendente (aprovação)
    var membrosPend = [];
    try {
        var lista = (typeof lerMembros === 'function') ? lerMembros() : [];
        membrosPend = lista.filter(function (m) {
            return m && (m.status === 'pendente' || m.status === 'aguardando');
        });
        if (membrosPend.length) nLaranja += membrosPend.length > 0 ? 1 : 0;
    } catch (e) {}
    var modelosPend = [];
    try {
        if (typeof listarModelosPendentes === 'function') {
            modelosPend = listarModelosPendentes() || [];
        }
    } catch (e) {}
    var nMod = modelosPend.length;
    if (nMod) nAzul += nMod; // modelos de escala = azul (aprovar formulário)
    return {
        celulas: celulas,
        ministerios: ministerios,
        membrosPendentes: membrosPend.length,
        modelosPendentes: modelosPend,
        nVermelho: nVermelho,
        nLaranja: nLaranja,
        nAzul: nAzul,
        total: nVermelho + nLaranja + nAzul + (membrosPend.length ? 1 : 0)
    };
}


/** Pendências na competência de quem está logado (menu Gestão vermelho) */
function pendenciasDoUsuarioLogado(u) {
    u = u || (typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null);
    if (!u) return { total: 0, motivos: [], href: 'index.html' };
    var motivos = [];
    var total = 0;
    var ehGestao = false;
    try {
        if (typeof isAdmin === 'function' && isAdmin(u)) ehGestao = true;
        if (u.nivel === 'admin' || u.nivel === 'gestor') ehGestao = true;
    } catch (e) {}

    if (ehGestao && typeof resumoPendenciasGestao === 'function') {
        var r = resumoPendenciasGestao();
        total = r.total || 0;
        if (r.nVermelho) motivos.push(r.nVermelho + ' cargo(s) vago(s)');
        if (r.nLaranja) motivos.push(r.nLaranja + ' aprovação(ões)');
        if (r.nAzul) motivos.push(r.nAzul + ' relatório(s)/modelo(s)');
        if (r.membrosPendentes) motivos.push(r.membrosPendentes + ' membro(s) pendente(s)');
        if (r.modelosPendentes && r.modelosPendentes.length) {
            motivos.push(r.modelosPendentes.length + ' formulário(s) de escala');
        }
        return {
            total: total,
            motivos: motivos,
            href: 'adminpainel.html',
            gestao: true,
            nVermelho: r.nVermelho || 0,
            nLaranja: r.nLaranja || 0,
            nAzul: r.nAzul || 0,
            membrosPendentes: r.membrosPendentes || 0
        };
    }

    // Líder de célula: pendências das células que lidera
    var celulasLider = [];
    if (typeof LISTA_CELULAS !== 'undefined' && typeof isLiderCelula === 'function') {
        LISTA_CELULAS.forEach(function (c) {
            if (isLiderCelula(u, c.id) || (u.lideraCelulaId && String(u.lideraCelulaId) === String(c.id))) {
                celulasLider.push(c);
            }
        });
    }
    celulasLider.forEach(function (c) {
        if (typeof statusPendenciasCelula !== 'function') return;
        var st = statusPendenciasCelula(c.id);
        if (st && st.cor) {
            total++;
            motivos.push((c.nome || c.id) + ': ' + (st.motivos || []).join(', '));
        }
    });

    // Líder de ministério
    var mins = [];
    if (u.lideraMinisterio) mins.push(String(u.lideraMinisterio));
    if (Array.isArray(u.ministerios) && u.cargo && /l[ií]der/i.test(String(u.cargo))) {
        u.ministerios.forEach(function (m) { if (mins.indexOf(String(m)) < 0) mins.push(String(m)); });
    }
    mins.forEach(function (nome) {
        if (typeof statusPendenciasMinisterio !== 'function') return;
        if (typeof isLiderDoMinisterio === 'function' && !isLiderDoMinisterio(u, nome) && !ehGestao) {
            // se só está na lista de lideraMinisterio ok
            if (!u.lideraMinisterio || String(u.lideraMinisterio).toLowerCase().indexOf(String(nome).toLowerCase()) < 0) return;
        }
        var st = statusPendenciasMinisterio(nome);
        if (st && st.cor) {
            total++;
            motivos.push('Ministério ' + nome + ': ' + (st.motivos || []).join(', '));
        }
    });

    var href = 'index.html';
    if (celulasLider.length) href = 'celulas.html';
    else if (mins.length) href = 'ministerios.html';

    return {
        total: total,
        motivos: motivos,
        href: href,
        gestao: false,
        temAutoridade: celulasLider.length > 0 || mins.length > 0
    };
}

function htmlBolinhaStatus(st) {
    if (!st || !st.cor) return '';
    var corCls = st.cor === 'vermelho' ? 'bg-red-500' : (st.cor === 'azul' ? 'bg-blue-500' : 'bg-amber-500');
    var titulo = (st.motivos || []).join(' · ') || st.cor;
    return '<span class="inline-block w-3 h-3 rounded-full ' + corCls + ' flex-shrink-0" title="' + String(titulo).replace(/"/g, '&quot;') + '"></span>';
}


/**
 * Define papel na célula: lider | anfitriao | lider_treino | membro
 * Gestor/admin ou líder da célula. Só um líder e um anfitrião por célula;
 * vários líderes em treinamento.
 */
function definirPapelNaCelula(membroId, celulaId, papel) {
    var u = typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null;
    if (!u) return { sucesso: false, mensagem: 'Faça login.' };
    var pode = false;
    try {
        if (typeof isAdmin === 'function' && isAdmin(u)) pode = true;
        if (typeof isGestor === 'function' && isGestor(u)) pode = true;
        if (u.nivel === 'admin' || u.nivel === 'gestor') pode = true;
        if (typeof isLiderCelula === 'function' && isLiderCelula(u, celulaId)) pode = true;
        if (typeof podeGerenciarPessoasCelula === 'function' && podeGerenciarPessoasCelula(celulaId)) pode = true;
    } catch (e) {}
    if (!pode) return { sucesso: false, mensagem: 'Somente gestor, admin ou líder desta célula podem alterar papéis.' };

    papel = String(papel || 'membro').toLowerCase().replace(/\s+/g, '_');
    if (papel === 'líder' || papel === 'lider_celula') papel = 'lider';
    if (papel === 'anfitrião' || papel === 'anfitria') papel = 'anfitriao';
    if (papel === 'treino' || papel === 'lider_em_treinamento') papel = 'lider_treino';
    if (['lider', 'anfitriao', 'lider_treino', 'membro'].indexOf(papel) < 0) {
        return { sucesso: false, mensagem: 'Papel inválido.' };
    }

    var lista = lerMembros();
    var idx = lista.findIndex(function (m) { return String(m.id) === String(membroId); });
    if (idx < 0) return { sucesso: false, mensagem: 'Membro não encontrado.' };
    var m = lista[idx];
    var cel = (typeof LISTA_CELULAS !== 'undefined' ? LISTA_CELULAS : []).find(function (c) { return c.id === celulaId; });
    if (!cel) return { sucesso: false, mensagem: 'Célula inválida.' };

    // Garante vínculo na célula
    if (!Array.isArray(m.celulas)) m.celulas = [];
    var ja = m.celulas.some(function (c) {
        return (typeof idCelulaDe === 'function' ? idCelulaDe(c) : (c && c.id)) === celulaId;
    });
    if (!ja) {
        m.celulas.push({ id: cel.id, nome: cel.nome, dia: cel.dia, papel: papel === 'membro' ? 'membro' : papel });
    } else {
        m.celulas = m.celulas.map(function (c) {
            var id = typeof idCelulaDe === 'function' ? idCelulaDe(c) : (c && c.id);
            if (id !== celulaId) return c;
            var o = Object.assign({}, c);
            if (papel === 'membro') {
                delete o.papel;
                o.papel = 'membro';
            } else if (papel === 'lider_treino') {
                o.papel = o.papel === 'lider' ? 'lider' : (o.papel || 'membro');
            } else {
                o.papel = papel;
            }
            return o;
        });
    }

    if (!m.celulaPapeis) m.celulaPapeis = {};
    if (!m.celulaPapeisStatus) m.celulaPapeisStatus = {};
    var arr = Array.isArray(m.celulaPapeis[celulaId]) ? m.celulaPapeis[celulaId].slice() : [];

    function semPapel(a, p) { return a.filter(function (x) { return x !== p; }); }

    if (papel === 'membro') {
        arr = semPapel(arr, 'lider');
        arr = semPapel(arr, 'anfitriao');
        arr = semPapel(arr, 'lider_treino');
        m.celulaPapeis[celulaId] = arr;
        if (m.lideraCelulaId && String(m.lideraCelulaId) === String(celulaId)) m.lideraCelulaId = '';
    } else if (papel === 'lider_treino') {
        if (arr.indexOf('lider_treino') < 0) arr.push('lider_treino');
        m.celulaPapeis[celulaId] = arr;
        if (!m.celulaPapeisStatus[celulaId] || m.celulaPapeisStatus[celulaId] === 'ok') {
            m.celulaPapeisStatus[celulaId] = 'em_analise';
        }
    } else {
        // lider ou anfitriao: só um por célula — remove dos outros
        lista.forEach(function (outro, j) {
            if (j === idx || !outro) return;
            var oc = Array.isArray(outro.celulas) ? outro.celulas : [];
            var nesta = oc.some(function (c) {
                return (typeof idCelulaDe === 'function' ? idCelulaDe(c) : (c && c.id)) === celulaId;
            });
            if (!nesta) return;
            if (!outro.celulaPapeis) outro.celulaPapeis = {};
            var oa = Array.isArray(outro.celulaPapeis[celulaId]) ? outro.celulaPapeis[celulaId].slice() : [];
            oa = semPapel(oa, papel);
            outro.celulaPapeis[celulaId] = oa;
            if (Array.isArray(outro.celulas)) {
                outro.celulas = outro.celulas.map(function (c) {
                    var id = typeof idCelulaDe === 'function' ? idCelulaDe(c) : (c && c.id);
                    if (id !== celulaId) return c;
                    var o = Object.assign({}, c);
                    if (String(o.papel || '') === papel) o.papel = 'membro';
                    return o;
                });
            }
            if (papel === 'lider' && outro.lideraCelulaId && String(outro.lideraCelulaId) === String(celulaId)) {
                outro.lideraCelulaId = '';
            }
            lista[j] = outro;
        });
        if (arr.indexOf(papel) < 0) arr.push(papel);
        // líder principal não precisa ficar só como treino
        if (papel === 'lider') arr = semPapel(arr, 'lider_treino');
        m.celulaPapeis[celulaId] = arr;
        m.celulaPapeisStatus[celulaId] = 'aprovado';
        if (papel === 'lider') {
            m.lideraCelulaId = celulaId;
            if (!m.cargo || /membro/i.test(String(m.cargo))) m.cargo = 'Líder de Célula';
        }
        if (papel === 'anfitriao') {
            if (!m.cargo || /membro/i.test(String(m.cargo))) m.cargo = 'Anfitrião';
        }
    }

    lista[idx] = m;
    if (typeof marcarMembroAtualizado === 'function') marcarMembroAtualizado(m);
    salvarMembros(lista);
    try {
        if (typeof enviarMembroParaNuvem === 'function') enviarMembroParaNuvem(m);
        // também os que perderam o papel
        lista.forEach(function (x) {
            if (x && String(x.id) !== String(m.id) && typeof enviarMembroParaNuvem === 'function') {
                try { enviarMembroParaNuvem(x); } catch (e2) {}
            }
        });
    } catch (e3) {}
    var labels = { lider: 'Líder', anfitriao: 'Anfitrião(ã)', lider_treino: 'Líder em treinamento', membro: 'Membro' };
    return { sucesso: true, mensagem: (m.nome || 'Membro') + ' → ' + (labels[papel] || papel), membro: m };
}

function adicionarMembroACelula(membroId, celulaId) {
    if (!podeGerenciarPessoasCelula(celulaId)) {
        return { sucesso: false, mensagem: 'Somente o líder ou o anfitrião desta célula podem adicionar pessoas.' };
    }
    const cel = (typeof LISTA_CELULAS !== 'undefined' ? LISTA_CELULAS : []).find(c => c.id === celulaId);
    if (!cel) return { sucesso: false, mensagem: 'Célula inválida.' };
    const lista = lerMembros();
    const idx = lista.findIndex(m => String(m.id) === String(membroId));
    if (idx < 0) return { sucesso: false, mensagem: 'Membro não encontrado.' };
    const m = lista[idx];
    if (!Array.isArray(m.celulas)) m.celulas = [];
    if (m.celulas.some(c => idCelulaDe(c) === celulaId)) {
        return { sucesso: false, mensagem: 'Esta pessoa já está nesta célula.' };
    }
    const v = validarCelulas(m.celulas.concat([{ id: cel.id, nome: cel.nome, dia: cel.dia }]));
    if (v.erro) return { sucesso: false, mensagem: v.erro };
    m.celulas = v.lista;
    lista[idx] = m;
    salvarMembros(lista);
    try {
        if (typeof IBNNuvem !== 'undefined') {
            if (IBNNuvem.sincronizarUmMembro) IBNNuvem.sincronizarUmMembro(m);
            if (IBNNuvem.registrarAtividade) IBNNuvem.registrarAtividade('vincular_celula', 'Vinculou ' + (m.nome || '') + ' à célula ' + cel.nome, getUsuarioLogado());
        }
    } catch (e) {}
    return { sucesso: true, membro: m };
}

/** Cadastro rápido de visitante vinculado à célula */
function cadastrarVisitanteCelula(dados, celulaId) {
    if (!podeGerenciarPessoasCelula(celulaId)) {
        return { sucesso: false, mensagem: 'Somente o líder ou o anfitrião desta célula podem cadastrar visitante.' };
    }
    const cel = (typeof LISTA_CELULAS !== 'undefined' ? LISTA_CELULAS : []).find(c => c.id === celulaId);
    if (!cel) return { sucesso: false, mensagem: 'Célula inválida.' };
    const nome = String(dados.nome || '').trim();
    if (nome.length < 2) return { sucesso: false, mensagem: 'Informe o nome do visitante.' };
    const nasc = normalizarDataParaISO(dados.nascimento || '');
    // mesma pessoa?
    const lista = lerMembros();
    const existente = lista.find(function (m) {
        return typeof mesmaPessoa === 'function' && mesmaPessoa(m, { nome: nome, nascimento: nasc });
    });
    if (existente) {
        return adicionarMembroACelula(existente.id, celulaId);
    }
    const novo = {
        id: Date.now(),
        nome: nome,
        email: (dados.email || '').trim() || ('visitante_' + Date.now() + '@ibn.local'),
        telefone: (dados.telefone || '').trim(),
        nascimento: nasc,
        endereco: (dados.endereco || '').trim(),
        municipio: (dados.municipio || '').trim(),
        uf: (dados.uf || 'MT').trim() || 'MT',
        estadoCivil: (dados.estadoCivil || '').trim(),
        batizado: !!dados.batizado,
        dataBatismo: dados.batizado ? (normalizarDataParaISO(dados.dataBatismo || '') || '') : '',
        celulas: [{ id: cel.id, nome: cel.nome, dia: cel.dia }],
        ministerios: [],
        cargo: 'Visitante',
        nivel: 'membro',
        status: 'visitante',
        tipo: 'visitante',
        dataCadastro: new Date().toISOString().slice(0, 10),
        senha: '',
        origem: 'celula:' + celulaId
    };
    lista.push(novo);
    salvarMembros(lista);
    try {
        if (typeof IBNNuvem !== 'undefined') {
            if (IBNNuvem.sincronizarUmMembro) IBNNuvem.sincronizarUmMembro(novo);
            if (IBNNuvem.registrarAtividade) IBNNuvem.registrarAtividade('visitante_celula', 'Cadastrou visitante ' + nome + ' na ' + cel.nome, getUsuarioLogado());
        }
    } catch (e) {}
    return { sucesso: true, membro: novo };
}

function buscarMembrosParaCelula(termo, celulaId) {
    termo = String(termo || '').toLowerCase().trim();
    if (termo.length < 2) return [];
    return lerMembros().filter(function (m) {
        const st = (m.status || '').toLowerCase();
        if (st === 'rejeitado' || st === 'recusado') return false;
        const ja = Array.isArray(m.celulas) && m.celulas.some(function (c) { return idCelulaDe(c) === celulaId; });
        if (ja) return false;
        const nome = String(m.nome || '').toLowerCase();
        const email = String(m.email || '').toLowerCase();
        const tel = String(m.telefone || '');
        return nome.indexOf(termo) !== -1 || email.indexOf(termo) !== -1 || tel.indexOf(termo) !== -1;
    }).slice(0, 12);
}

function isAnfitriaoCelula(u, celulaId) {
    u = u || getUsuarioLogado();
    if (!u || !celulaId) return false;
    if (Array.isArray(u.celulas)) {
        const porPapel = u.celulas.some(function (c) {
            const id = typeof idCelulaDe === 'function' ? idCelulaDe(c) : (c && c.id);
            const papel = String(c.papel || '').toLowerCase();
            const papeis = Array.isArray(c.papeis) ? c.papeis.join(' ') : '';
            return String(id) === String(celulaId) && (papel.indexOf('anfitri') !== -1 || String(papeis).toLowerCase().indexOf('anfitri') !== -1);
        });
        if (porPapel) return true;
    }
    if (Array.isArray(u.funcoes) && u.funcoes.indexOf('anfitriao') !== -1) {
        if (!Array.isArray(u.celulas)) return false;
        return u.celulas.some(function (c) {
            return (typeof idCelulaDe === 'function' ? idCelulaDe(c) : (c && c.id)) === celulaId;
        });
    }
    const eq = (typeof equipeDaCelula === 'function') ? equipeDaCelula(celulaId) : null;
    if (eq && eq.anfitriao && String(eq.anfitriao.id) === String(u.id)) return true;
    const fn = String(u.funcaoEspecifica || u.cargo || '').toLowerCase();
    if (fn.indexOf('anfitri') === -1) return false;
    if (!Array.isArray(u.celulas)) return false;
    return u.celulas.some(function (c) {
        return (typeof idCelulaDe === 'function' ? idCelulaDe(c) : (c && c.id)) === celulaId;
    });
}

/** Líder ou anfitrião da célula: adicionar membros/visitantes e chamada */
function podeGerenciarPessoasCelula(celulaId) {
    const u = getUsuarioLogado();
    if (!u || !celulaId) return false;
    if (isLiderCelula(u, celulaId)) return true;
    if (isAnfitriaoCelula(u, celulaId)) return true;
    return false;
}

/** Relatório com ofertas: só líder da célula (secretaria/gestor também veem/exportam) */

/** Remove vínculo do membro com a célula (continua membro da igreja) */

/** Ajuste de localização do encontro: líder da célula, líder em treinamento ou anfitrião (sem precisar da gestão). Membros só visualizam. */
function podeAjustarLocalCelula(celulaId) {
    var u = getUsuarioLogado();
    if (!u || !celulaId) return false;
    if (typeof isAdmin === 'function' && isAdmin(u)) return true;
    if (typeof isGestor === 'function' && isGestor(u)) return true;
    if (typeof isLiderCelula === 'function' && isLiderCelula(u, celulaId)) return true;
    if (typeof isAnfitriaoCelula === 'function' && isAnfitriaoCelula(u, celulaId)) return true;
    // líder em treinamento nesta célula
    try {
        var eq = typeof equipeDaCelula === 'function' ? equipeDaCelula(celulaId) : null;
        if (eq && Array.isArray(eq.lideresTreino)) {
            if (eq.lideresTreino.some(function (m) { return m && String(m.id) === String(u.id); })) return true;
        }
        if (eq && eq.liderTreino && String(eq.liderTreino.id) === String(u.id)) return true;
    } catch (e) {}
    return false;
}


function removerMembroDaCelula(membroId, celulaId) {
    if (!podeGerenciarPessoasCelula(celulaId)) {
        return { sucesso: false, mensagem: 'Somente o líder ou o anfitrião podem remover desta célula.' };
    }
    const lista = lerMembros();
    const idx = lista.findIndex(m => String(m.id) === String(membroId));
    if (idx < 0) return { sucesso: false, mensagem: 'Membro não encontrado.' };
    const m = lista[idx];
    if (!Array.isArray(m.celulas)) m.celulas = [];
    m.celulas = m.celulas.filter(function (c) {
        return (typeof idCelulaDe === 'function' ? idCelulaDe(c) : (c && c.id)) !== celulaId;
    });
    // se era líder desta célula no cargo, não remove nível global automaticamente
    lista[idx] = m;
    salvarMembros(lista);
    try {
        if (typeof IBNNuvem !== 'undefined') {
            if (IBNNuvem.sincronizarUmMembro) IBNNuvem.sincronizarUmMembro(m);
            if (IBNNuvem.registrarAtividade) {
                IBNNuvem.registrarAtividade('desvincular_celula', 'Removeu ' + (m.nome || '') + ' da célula ' + celulaId, getUsuarioLogado());
            }
        }
    } catch (e) {}
    return { sucesso: true, membro: m };
}

function podeGerenciarPessoasMinisterio(nomeMinisterio) {
    const u = getUsuarioLogado();
    if (!u || !nomeMinisterio) return false;
    if (isAdmin(u) || isGestor(u)) return true;
    return isLiderMinisterio(u, nomeMinisterio);
}

function adicionarMembroAoMinisterio(membroId, nomeMinisterio) {
    if (!podeGerenciarPessoasMinisterio(nomeMinisterio)) {
        return { sucesso: false, mensagem: 'Somente o líder deste ministério pode adicionar membros.' };
    }
    const nome = String(nomeMinisterio || '').trim();
    if (!nome) return { sucesso: false, mensagem: 'Ministério inválido.' };
    const lista = lerMembros();
    const idx = lista.findIndex(m => String(m.id) === String(membroId));
    if (idx < 0) return { sucesso: false, mensagem: 'Membro não encontrado.' };
    const m = lista[idx];
    if (!Array.isArray(m.ministerios)) m.ministerios = [];
    const ja = m.ministerios.some(function (x) {
        return normalizarNomeMinisterio(x) === normalizarNomeMinisterio(nome);
    });
    if (ja) return { sucesso: false, mensagem: 'Esta pessoa já está neste ministério.' };
    m.ministerios.push(nome);
    lista[idx] = m;
    salvarMembros(lista);
    try {
        if (typeof IBNNuvem !== 'undefined') {
            if (IBNNuvem.sincronizarUmMembro) IBNNuvem.sincronizarUmMembro(m);
            if (IBNNuvem.registrarAtividade) {
                IBNNuvem.registrarAtividade('vincular_ministerio', 'Vinculou ' + (m.nome || '') + ' ao ministério ' + nome, getUsuarioLogado());
            }
        }
    } catch (e) {}
    return { sucesso: true, membro: m };
}

/** Remove só do ministério — continua membro da igreja (e de células/outros ministérios) */
function removerMembroDoMinisterio(membroId, nomeMinisterio) {
    if (!podeGerenciarPessoasMinisterio(nomeMinisterio)) {
        return { sucesso: false, mensagem: 'Somente o líder deste ministério pode remover membros.' };
    }
    const nome = String(nomeMinisterio || '').trim();
    const lista = lerMembros();
    const idx = lista.findIndex(m => String(m.id) === String(membroId));
    if (idx < 0) return { sucesso: false, mensagem: 'Membro não encontrado.' };
    const m = lista[idx];
    if (!Array.isArray(m.ministerios)) m.ministerios = [];
    m.ministerios = m.ministerios.filter(function (x) {
        return normalizarNomeMinisterio(x) !== normalizarNomeMinisterio(nome);
    });
    lista[idx] = m;
    salvarMembros(lista);
    try {
        if (typeof IBNNuvem !== 'undefined') {
            if (IBNNuvem.sincronizarUmMembro) IBNNuvem.sincronizarUmMembro(m);
            if (IBNNuvem.registrarAtividade) {
                IBNNuvem.registrarAtividade('desvincular_ministerio', 'Removeu ' + (m.nome || '') + ' do ministério ' + nome, getUsuarioLogado());
            }
        }
    } catch (e) {}
    return { sucesso: true, membro: m };
}

function buscarMembrosParaMinisterio(termo, nomeMinisterio) {
    termo = String(termo || '').toLowerCase().trim();
    if (termo.length < 2) return [];
    const alvo = normalizarNomeMinisterio(nomeMinisterio);
    return lerMembros().filter(function (m) {
        const st = (m.status || '').toLowerCase();
        if (st === 'rejeitado' || st === 'recusado') return false;
        const mins = Array.isArray(m.ministerios) ? m.ministerios : [];
        const ja = mins.some(function (x) { return normalizarNomeMinisterio(x) === alvo; });
        if (ja) return false;
        const nome = String(m.nome || '').toLowerCase();
        const email = String(m.email || '').toLowerCase();
        const tel = String(m.telefone || '');
        return nome.indexOf(termo) !== -1 || email.indexOf(termo) !== -1 || tel.indexOf(termo) !== -1;
    }).slice(0, 12);
}

function podeEditarRelatorioCelula(celulaId) {
    const u = getUsuarioLogado();
    if (!u) return false;
    if (isAdmin(u) || isGestor(u)) return true;
    return isLiderCelula(u, celulaId);
}

function salvarRelatorioCelula(dados) {
    const u = getUsuarioLogado();
    if (!u) return { sucesso: false, mensagem: 'Faça login.' };
    if (!dados || !dados.celulaId) return { sucesso: false, mensagem: 'Célula inválida.' };
    if (!podeEditarRelatorioCelula(dados.celulaId)) {
        return { sucesso: false, mensagem: 'Sem permissão para esta célula.' };
    }

    const ofertaPix = parseFloat(dados.ofertaPix) || 0;
    const ofertaEspecie = parseFloat(dados.ofertaEspecie) || 0;
    const presentes = Array.isArray(dados.presentes) ? dados.presentes : [];

    const qtdVisitantes = Math.max(0, parseInt(dados.qtdVisitantes, 10) || 0);
    const qtdMembrosPresentes = presentes.length || parseInt(dados.qtdPresentes, 10) || 0;
    const rel = {
        id: dados.id || ('rel-' + Date.now()),
        celulaId: dados.celulaId,
        data: dados.data || new Date().toISOString().slice(0, 10),
        presentes: presentes,
        qtdPresentes: qtdMembrosPresentes,
        qtdVisitantes: qtdVisitantes,
        qtdTotal: qtdMembrosPresentes + qtdVisitantes,
        ofertaPix: ofertaPix,
        ofertaEspecie: ofertaEspecie,
        totalOfertas: ofertaPix + ofertaEspecie,
        observacoes: (dados.observacoes || '').trim(),
        autorId: u.id,
        autorNome: u.nome,
        criadoEm: dados.criadoEm || new Date().toISOString(),
        atualizadoEm: new Date().toISOString()
    };

    const lista = lerRelatoriosCelula();
    const idx = lista.findIndex(r => r.id === rel.id);
    if (idx >= 0) lista[idx] = rel;
    else lista.push(rel);
    var eraEdicao = idx >= 0;
    salvarRelatoriosCelula(lista);
    // Cópia na nuvem (se configurada) + log na movimentação do gestor
    try {
        if (typeof IBNNuvem !== 'undefined') {
            if (IBNNuvem.sincronizarRelatorio) {
                IBNNuvem.sincronizarRelatorio(rel).then(function (rr) {
                    if (rr && !rr.sucesso && typeof avisarFalhaNuvem === 'function') {
                        avisarFalhaNuvem('Relatório de célula', rr.mensagem || 'Não subiu para a nuvem');
                    }
                }).catch(function (e) {
                    if (typeof avisarFalhaNuvem === 'function') {
                        avisarFalhaNuvem('Relatório de célula', (e && e.message) || String(e));
                    }
                });
            }
            if (IBNNuvem.registrarAtividade) {
                var nomeCel = rel.celulaId;
                try {
                    if (typeof LISTA_CELULAS !== 'undefined') {
                        var c = LISTA_CELULAS.find(function (x) { return x.id === rel.celulaId; });
                        if (c && c.nome) nomeCel = c.nome;
                    }
                } catch (e2) {}
                var acao = eraEdicao ? 'Editou relatório' : 'Registrou relatório';
                var det = acao + ' da célula ' + nomeCel +
                    ' em ' + rel.data +
                    ' · ' + (rel.qtdPresentes || 0) + ' presentes' +
                    ' · PIX R$ ' + (Number(rel.ofertaPix) || 0).toFixed(2).replace('.', ',') +
                    ' · Espécie R$ ' + (Number(rel.ofertaEspecie) || 0).toFixed(2).replace('.', ',') +
                    ' · Total R$ ' + (Number(rel.totalOfertas) || 0).toFixed(2).replace('.', ',');
                if (rel.observacoes) det += ' · Obs: ' + String(rel.observacoes).slice(0, 80);
                IBNNuvem.registrarAtividade(
                    eraEdicao ? 'relatorio_celula_editar' : 'relatorio_celula',
                    det,
                    u
                );
            }
        }
    } catch (e) { console.warn('log relatório célula', e); }
    return { sucesso: true, relatorio: rel };
}

function relatoriosDaCelula(celulaId) {
    return lerRelatoriosCelula()
        .filter(r => r.celulaId === celulaId)
        .sort((a, b) => (b.data || '').localeCompare(a.data || ''));
}


/** CSV no padrão Excel Brasil: ; como separador, UTF-8 com BOM, colunas fixas */
function csvEscapar(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    s = s.replace(/\r?\n/g, ' ').replace(/"/g, '""');
    return '"' + s + '"';
}
function montarCSV(cabecalhos, linhas) {
    var sep = ';';
    var head = cabecalhos.map(csvEscapar).join(sep);
    var body = (linhas || []).map(function(row) {
        return row.map(csvEscapar).join(sep);
    }).join('\n');
    return '\uFEFF' + head + '\n' + body;
}
function dataArquivoBR(d) {
    var dt = d ? new Date(d) : new Date();
    if (isNaN(dt.getTime())) dt = new Date();
    var dd = String(dt.getDate()).padStart(2, '0');
    var mm = String(dt.getMonth() + 1).padStart(2, '0');
    var aa = dt.getFullYear();
    return dd + '-' + mm + '-' + aa;
}
function formatarDataCSV(d) {
    if (!d) return '';
    d = String(d).trim();
    if (/^\d{2}\/\d{2}\/\d{4}/.test(d)) return d.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
        var p = d.slice(0, 10).split('-');
        return p[2] + '/' + p[1] + '/' + p[0];
    }
    return d;
}
function exportarMembrosCSVDefinido(lista) {
    lista = lista || (typeof lerMembros === 'function' ? lerMembros() : []);
    var cols = [
        'Nome', 'Email', 'Telefone', 'Batizado', 'Funções', 'Data de Cadastro',
        'Nascimento', 'Sexo', 'Estado Civil', 'Endereço', 'Município', 'UF',
        'Células', 'Ministérios', 'Status', 'Nível'
    ];
    var linhas = lista.map(function(m) {
        var funcoes = [];
        if (m.cargo) funcoes.push(m.cargo);
        if (Array.isArray(m.funcoesAprovadas)) {
            m.funcoesAprovadas.forEach(function(f) { if (funcoes.indexOf(f) === -1) funcoes.push(f); });
        }
        if (Array.isArray(m.funcoes)) {
            m.funcoes.forEach(function(f) {
                var map = { lider_celula: 'Líder de Célula', lider_ministerio: 'Líder de Ministério', lider_treino: 'Líder em treinamento', anfitriao: 'Anfitrião', admin: 'Administrador', gestor: 'Gestor' };
                var lab = map[f] || f;
                if (funcoes.indexOf(lab) === -1) funcoes.push(lab);
            });
        }
        if (!funcoes.length) funcoes.push('Membro');
        var celulas = Array.isArray(m.celulas) ? m.celulas.map(function(c) { return c.nome || c.id || c; }).join(' | ') : '';
        var mins = Array.isArray(m.ministerios) ? m.ministerios.join(' | ') : (m.ministerios || '');
        var bat = (m.batizado === true || m.batizado === 'sim' || m.batismo === 'sim') ? 'Sim' : (m.batizado === false || m.batizado === 'nao' || m.batismo === 'nao' ? 'Não' : (m.batizado || ''));
        return [
            m.nome || '',
            m.email || '',
            m.telefone || '',
            bat,
            funcoes.join(', '),
            formatarDataCSV(m.dataCadastro || m.criadoEm || m.dataInscricao || ''),
            formatarDataCSV(m.nascimento || ''),
            m.sexo || '',
            m.estadoCivil || '',
            m.endereco || '',
            m.municipio || '',
            m.uf || '',
            celulas,
            mins,
            m.status || '',
            m.nivel || ''
        ];
    });
    return montarCSV(cols, linhas);
}
function exportarVisitantesCSVDefinido(lista) {
    lista = lista || [];
    try {
        if (!lista.length) {
            var v = JSON.parse(localStorage.getItem('ibn_visitantes') || '[]');
            if (Array.isArray(v)) lista = v;
        }
    } catch (e) {}
    var cols = [
        'NomeCompleto', 'DataNascimento', 'Idade', 'DataVisita', 'Telefone', 'EstadoCivil',
        'Endereco', 'Bairro', 'Cidade', 'AceitouJesus', 'Batizado', 'DataBatismo',
        'Observacoes', 'Celula', 'AtividadeNaCelula'
    ];
    var linhas = lista.map(function(v) {
        return [
            v.nome || v.NomeCompleto || '',
            formatarDataCSV(v.nascimento || v.DataNascimento || ''),
            v.idade || v.Idade || '',
            formatarDataCSV(v.dataVisita || v.DataVisita || v.criadoEm || ''),
            v.telefone || v.Telefone || '',
            v.estadoCivil || v.EstadoCivil || '',
            v.endereco || v.Endereco || '',
            v.bairro || v.Bairro || '',
            v.municipio || v.cidade || v.Cidade || '',
            v.aceitouJesus || v.AceitouJesus || '',
            (v.batizado === true || v.batizado === 'sim') ? 'Sim' : (v.batizado === false || v.batizado === 'nao' ? 'Não' : (v.batizado || v.Batizado || '')),
            formatarDataCSV(v.dataBatismo || v.DataBatismo || ''),
            v.observacoes || v.Observacoes || '',
            v.celula || v.Celula || '',
            v.atividade || v.AtividadeNaCelula || ''
        ];
    });
    return montarCSV(cols, linhas);
}


// ========== ANIVERSARIANTES (somente membros) ==========
function _mdNascimento(m) {
    var iso = normalizarDataParaISO(m.nascimento || m.dataNascimento || '');
    if (!iso || iso.length < 10) return null;
    return { mes: parseInt(iso.slice(5, 7), 10), dia: parseInt(iso.slice(8, 10), 10), iso: iso };
}
function _idadeAniversario(isoNasc, refDate) {
    if (!isoNasc) return null;
    var n = new Date(isoNasc.slice(0, 10) + 'T12:00:00');
    if (isNaN(n.getTime())) return null;
    var r = refDate || new Date();
    var idade = r.getFullYear() - n.getFullYear();
    var m = r.getMonth() - n.getMonth();
    if (m < 0 || (m === 0 && r.getDate() < n.getDate())) idade--;
    return idade;
}
function listarAniversariantesNaData(refDate) {
    refDate = refDate || new Date();
    var mes = refDate.getMonth() + 1;
    var dia = refDate.getDate();
    var lista = (typeof lerMembros === 'function' ? lerMembros() : []).filter(function (m) {
        if (!m || m.status === 'rejeitado' || m.status === 'excluido') return false;
        if (m.tipo === 'visitante' || m.status === 'visitante') return false;
        var md = _mdNascimento(m);
        return md && md.mes === mes && md.dia === dia;
    });
    return lista.map(function (m) {
        var md = _mdNascimento(m);
        return {
            id: m.id,
            nome: m.nome || '',
            telefone: m.telefone || '',
            email: m.email || '',
            nascimento: md ? md.iso : '',
            idade: _idadeAniversario(md ? md.iso : null, refDate)
        };
    }).sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
}
function listarAniversariantesHoje() {
    return listarAniversariantesNaData(new Date());
}
/** Próximos N dias (inclui hoje se houver). Retorna [{ dataIso, dataBR, aniversariantes: [] }] */
function listarProximosAniversariantes(dias) {
    dias = dias || 8;
    var out = [];
    var base = new Date();
    base.setHours(12, 0, 0, 0);
    for (var i = 0; i <= dias; i++) {
        var d = new Date(base.getTime());
        d.setDate(base.getDate() + i);
        var lista = listarAniversariantesNaData(d);
        if (!lista.length) continue;
        var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        var br = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
        out.push({ dataIso: iso, dataBR: br, diasAte: i, aniversariantes: lista });
    }
    return out;
}

/** Aniversariantes do mês (1-12). Ano só para calcular idade aproximada. */
function listarAniversariantesDoMes(mes, ano) {
    mes = parseInt(mes, 10);
    ano = parseInt(ano, 10) || (new Date()).getFullYear();
    if (!mes || mes < 1 || mes > 12) return [];
    var membros = lerMembros();
    var lista = [];
    membros.forEach(function (m) {
        if (!m || ehContaMasterSistema(m)) return;
        if (m.tipo === 'visitante' || m.status === 'visitante') return;
        if (m.status === 'bloqueado' || m.bloqueado) return;
        var md = _mdNascimento(m);
        if (!md || md.mes !== mes) return;
        var ref = new Date(ano, mes - 1, md.dia || 1, 12, 0, 0);
        lista.push({
            id: m.id,
            nome: m.nome || '',
            telefone: m.telefone || '',
            email: m.email || '',
            nascimento: md.iso || '',
            dia: md.dia,
            mes: md.mes,
            idade: _idadeAniversario(md.iso, ref)
        });
    });
    lista.sort(function (a, b) {
        if (a.dia !== b.dia) return a.dia - b.dia;
        return String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    });
    return lista;
}

function ehAniversarioHojeMembro(m) {
    if (!m) return false;
    var md = _mdNascimento(m);
    if (!md) return false;
    var hoje = new Date();
    return md.mes === (hoje.getMonth() + 1) && md.dia === hoje.getDate();
}
function mensagemAniversarioPadrao(nomeAniv, nomeRemetente) {
    var n = (nomeAniv || 'irmão(ã)').split(' ')[0];
    var de = (nomeRemetente || '').split(' ')[0];
    return '🎂 Feliz aniversário, ' + n + '!\n\nQue Deus continue abençoando sua vida com muita paz, saúde e alegria. A família IBN Diamantino celebra este dia com você!\n\nCom carinho' + (de ? ', ' + de : '') + ' 🙏';
}
function linkWhatsAppAniversario(telefone, texto) {
    var dig = String(telefone || '').replace(/\D/g, '');
    if (!dig) return null;
    if (dig.length <= 11) dig = '55' + dig;
    return 'https://wa.me/' + dig + '?text=' + encodeURIComponent(texto || '');
}
function registrarMensagemAniversarioLocal(deId, deNome, paraId, paraNome, texto) {
    try {
        var key = 'ibn_msgs_aniversario';
        var arr = JSON.parse(localStorage.getItem(key) || '[]');
        arr.push({
            id: 'msg-' + Date.now(),
            deId: deId, deNome: deNome,
            paraId: paraId, paraNome: paraNome,
            texto: texto,
            em: new Date().toISOString()
        });
        if (arr.length > 200) arr = arr.slice(-200);
        localStorage.setItem(key, JSON.stringify(arr));
    } catch (e) {}
}




/** Status amigável: em_analise (âmbar) em vez de "rejeitado" / exclusão */
function statusPapelCelula(m, celulaId) {
    if (!m) return 'ok';
    if (m.status === 'pendente' || m.status === 'aguardando' || m.statusAprovacao === 'pendente') return 'em_analise';
    var st = (m.celulaPapeisStatus && m.celulaPapeisStatus[celulaId]) || m.papelCelulaStatus || '';
    if (st === 'em_analise' || st === 'pendente' || st === 'aguardando') return 'em_analise';
    if (st === 'aprovado' || st === 'ok') return 'ok';
    // líder em treinamento sem aprovação explícita
    var pp = (typeof papeisNaCelula === 'function') ? papeisNaCelula(m, celulaId) : [];
    if (pp.indexOf('lider_treino') >= 0 && st !== 'aprovado') {
        if (!st || st === 'indicado') return 'em_analise';
    }
    return 'ok';
}

function corStatusAnalise(st) {
    if (st === 'em_analise') return { cor: 'amber', label: 'Em análise', classe: 'bg-amber-100 text-amber-800 border-amber-300' };
    if (st === 'aprovado' || st === 'ok') return { cor: 'green', label: 'Ok', classe: 'bg-green-50 text-green-800 border-green-200' };
    return { cor: 'gray', label: '', classe: '' };
}

/** Líder indica membro como líder em treinamento (fica em análise até gestão aprovar) */
function indicarLiderEmTreinamento(membroId, celulaId) {
    var u = getUsuarioLogado();
    if (!u) return { sucesso: false, mensagem: 'Faça login.' };
    if (!podeGerenciarCelula(celulaId) && !(typeof isAdmin === 'function' && isAdmin(u))) {
        return { sucesso: false, mensagem: 'Sem permissão.' };
    }
    var lista = lerMembros();
    var idx = lista.findIndex(function (m) { return String(m.id) === String(membroId); });
    if (idx < 0) return { sucesso: false, mensagem: 'Membro não encontrado.' };
    var m = lista[idx];
    if (!m.celulaPapeis) m.celulaPapeis = {};
    if (!m.celulaPapeisStatus) m.celulaPapeisStatus = {};
    var arr = Array.isArray(m.celulaPapeis[celulaId]) ? m.celulaPapeis[celulaId].slice() : [];
    if (arr.indexOf('lider_treino') < 0) arr.push('lider_treino');
    m.celulaPapeis[celulaId] = arr;
    m.celulaPapeisStatus[celulaId] = 'em_analise';
    if (!m.cargo || m.cargo === 'Membro') m.cargo = 'Líder em treinamento';
    lista[idx] = m;
    salvarMembros(lista);
    return { sucesso: true, mensagem: 'Indicação registrada — status: Em análise (gestão aprova).', membro: m };
}

/** Gestão aprova ou mantém em análise o líder em treinamento */
function decidirLiderEmTreinamento(membroId, celulaId, aprovar) {
    var u = getUsuarioLogado();
    if (!u || !(isAdmin(u) || isGestor(u))) return { sucesso: false, mensagem: 'Só admin/gestor.' };
    var lista = lerMembros();
    var idx = lista.findIndex(function (m) { return String(m.id) === String(membroId); });
    if (idx < 0) return { sucesso: false, mensagem: 'Membro não encontrado.' };
    var m = lista[idx];
    if (!m.celulaPapeisStatus) m.celulaPapeisStatus = {};
    if (aprovar) {
        m.celulaPapeisStatus[celulaId] = 'aprovado';
        m.cargo = 'Líder em treinamento';
    } else {
        // não é exclusão — volta para em análise / remove só se gestão quiser "não neste momento"
        m.celulaPapeisStatus[celulaId] = 'em_analise';
    }
    lista[idx] = m;
    salvarMembros(lista);
    return { sucesso: true, mensagem: aprovar ? 'Aprovado como líder em treinamento.' : 'Mantido em análise.', membro: m };
}

/** Participação em ministério: em_analise até líder do ministério ou gestão aprovar */
function statusMinisterioMembro(m, nomeMin) {
    if (!m || !nomeMin) return 'ok';
    var key = String(nomeMin).trim().toLowerCase();
    var stMap = m.ministeriosStatus || {};
    var st = stMap[nomeMin] || stMap[key] || '';
    if (st === 'em_analise' || st === 'pendente') return 'em_analise';
    if (st === 'aprovado' || st === 'ok') return 'ok';
    // se está na lista de ministérios mas sem status → em análise (solicitação)
    var mins = Array.isArray(m.ministerios) ? m.ministerios : [];
    var naLista = mins.some(function (x) { return String(x).trim().toLowerCase() === key; });
    if (naLista && !st) return 'em_analise';
    return 'ok';
}

function marcarParticipacaoMinisterio(membroId, nomeMin, status) {
    var u = getUsuarioLogado();
    if (!u) return { sucesso: false, mensagem: 'Faça login.' };
    var pode = isAdmin(u) || isGestor(u);
    if (!pode && typeof eLiderDoMinisterio === 'function') pode = eLiderDoMinisterio(u, nomeMin);
    if (!pode && typeof ministeriosQueLidera === 'function') {
        pode = ministeriosQueLidera(u).some(function (x) { return String(x).toLowerCase() === String(nomeMin).toLowerCase(); });
    }
    if (!pode) return { sucesso: false, mensagem: 'Sem permissão (líder do ministério, admin ou gestor).' };
    var lista = lerMembros();
    var idx = lista.findIndex(function (m) { return String(m.id) === String(membroId); });
    if (idx < 0) return { sucesso: false, mensagem: 'Membro não encontrado.' };
    var m = lista[idx];
    if (!m.ministeriosStatus) m.ministeriosStatus = {};
    m.ministeriosStatus[nomeMin] = status; // 'em_analise' | 'aprovado'
    // garante que está na lista de ministérios se aprovado ou em análise
    if (!Array.isArray(m.ministerios)) m.ministerios = [];
    if (m.ministerios.indexOf(nomeMin) < 0) m.ministerios.push(nomeMin);
    lista[idx] = m;
    salvarMembros(lista);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.sincronizarMembro) IBNNuvem.sincronizarMembro(m);
    } catch (e) {}
    return { sucesso: true, mensagem: status === 'aprovado' ? 'Participação aprovada.' : 'Marcado em análise.', membro: m };
}

/**
 * Resumo de frequência para pastor/gestão.
 * mes: 'YYYY-MM' ou null = todos
 */
function resumoFrequenciaCelulas(mes) {
    var rels = (typeof lerRelatoriosCelula === 'function') ? lerRelatoriosCelula() : [];
    var porCelula = {};
    rels.forEach(function (r) {
        if (!r || !r.celulaId) return;
        var d = String(r.data || '').slice(0, 7);
        if (mes && d !== mes) return;
        if (!porCelula[r.celulaId]) {
            porCelula[r.celulaId] = {
                celulaId: r.celulaId,
                encontros: 0,
                somaMembros: 0,
                somaVisitantes: 0,
                somaTotal: 0,
                dias: []
            };
        }
        var qM = parseInt(r.qtdPresentes, 10) || (Array.isArray(r.presentes) ? r.presentes.length : 0) || 0;
        var qV = parseInt(r.qtdVisitantes, 10) || 0;
        var qT = parseInt(r.qtdTotal, 10) || (qM + qV);
        porCelula[r.celulaId].encontros += 1;
        porCelula[r.celulaId].somaMembros += qM;
        porCelula[r.celulaId].somaVisitantes += qV;
        porCelula[r.celulaId].somaTotal += qT;
        porCelula[r.celulaId].dias.push({
            data: r.data,
            membros: qM,
            visitantes: qV,
            total: qT,
            ofertas: r.totalOfertas || 0
        });
    });
    var celulas = (typeof LISTA_CELULAS !== 'undefined') ? LISTA_CELULAS : [];
    return Object.keys(porCelula).map(function (id) {
        var x = porCelula[id];
        var nome = id;
        var c = celulas.find(function (z) { return z.id === id; });
        if (c && c.nome) nome = c.nome;
        x.nome = nome;
        x.mediaMembros = x.encontros ? (x.somaMembros / x.encontros) : 0;
        x.mediaVisitantes = x.encontros ? (x.somaVisitantes / x.encontros) : 0;
        x.mediaTotal = x.encontros ? (x.somaTotal / x.encontros) : 0;
        x.dias.sort(function (a, b) { return String(a.data).localeCompare(String(b.data)); });
        return x;
    }).sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome)); });
}

function exportarRelatoriosCSV(celulaIdFiltro) {
    const u = getUsuarioLogado();
    if (!u) return { sucesso: false, mensagem: 'Faça login.' };
    // Relatório geral CSV: secretaria (admin) e gestor. Uma célula: também o líder dela.
    if (!celulaIdFiltro && !podeExportarRelatoriosGeral(u)) {
        return { sucesso: false, mensagem: 'Relatórios gerais: somente secretaria ou gestor.' };
    }
    if (celulaIdFiltro && !(isAdmin(u) || isLiderCelula(u, celulaIdFiltro))) {
        return { sucesso: false, mensagem: 'Sem permissão para exportar esta célula.' };
    }
    let lista = lerRelatoriosCelula();
    if (celulaIdFiltro) lista = lista.filter(r => r.celulaId === celulaIdFiltro);
    if (!lista.length) return { sucesso: false, mensagem: 'Nenhum relatório para exportar.' };

    const cols = ['Data', 'Célula', 'Qtd membros presentes', 'Qtd visitantes', 'Qtd total', 'Oferta PIX', 'Oferta espécie', 'Total ofertas', 'Observações', 'Registrado por'];
    const linhas = lista.map(r => {
        const cel = (typeof LISTA_CELULAS !== 'undefined') ? LISTA_CELULAS.find(c => c.id === r.celulaId) : null;
        const nomeCel = cel ? cel.nome : r.celulaId;
        const qM = r.qtdPresentes || (Array.isArray(r.presentes) ? r.presentes.length : 0) || 0;
        const qV = r.qtdVisitantes || 0;
        const qT = (r.qtdTotal != null) ? r.qtdTotal : (Number(qM) + Number(qV));
        return [
            formatarDataCSV(r.data || ''),
            nomeCel || '',
            qM,
            qV,
            qT,
            (Number(r.ofertaPix || 0)).toFixed(2).replace('.', ','),
            (Number(r.ofertaEspecie || 0)).toFixed(2).replace('.', ','),
            (Number(r.totalOfertas || 0)).toFixed(2).replace('.', ','),
            r.observacoes || '',
            r.autorNome || ''
        ];
    });
    const csv = montarCSV(cols, linhas);
    const dataArq = dataArquivoBR();
    const nomeArquivo = celulaIdFiltro
        ? ('relatorio-celula-' + celulaIdFiltro + '_' + dataArq + '.csv')
        : ('relatorios-celulas-geral_' + dataArq + '.csv');
    return { sucesso: true, csv: csv, nomeArquivo: nomeArquivo };
}

function baixarCSV(conteudo, nomeArquivo) {
    // Garante BOM se ainda não tiver
    if (conteudo && conteudo.charCodeAt(0) !== 0xFEFF) conteudo = '﻿' + conteudo;
    const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo || 'relatorio.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}




// ========== AGENDA LOCAL — FUTEBOL DOS HOMENS (segundas) ==========
const CHAVE_AGENDA_FUTEBOL = 'ibn_agenda_futebol_homens';

function lerAgendaFutebol() {
    try { return JSON.parse(localStorage.getItem(CHAVE_AGENDA_FUTEBOL) || '[]'); }
    catch (e) { return []; }
}
function salvarAgendaFutebol(lista) {
    localStorage.setItem(CHAVE_AGENDA_FUTEBOL, JSON.stringify(lista || []));
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.db) {
            // opcional: config/site_midia style
        }
        if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
            firebase.firestore().collection('config').doc('agenda_futebol_homens').set({
                itens: lista || [],
                atualizadoEm: new Date().toISOString()
            }, { merge: true }).catch(function () {});
        }
    } catch (e2) {}
}

// Catálogo de campos/locais reutilizáveis (nome + GPS)
const CHAVE_CATALOGO_FUTEBOL = 'ibn_catalogo_locais_futebol';

function lerCatalogoLocaisFutebol() {
    try { return JSON.parse(localStorage.getItem(CHAVE_CATALOGO_FUTEBOL) || '[]'); }
    catch (e) { return []; }
}
function salvarCatalogoLocaisFutebol(lista) {
    localStorage.setItem(CHAVE_CATALOGO_FUTEBOL, JSON.stringify(lista || []));
    try {
        if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
            firebase.firestore().collection('config').doc('catalogo_futebol_homens').set({
                itens: lista || [],
                atualizadoEm: new Date().toISOString()
            }, { merge: true }).catch(function () {});
        }
    } catch (e2) {}
}
/** Remove um local do catálogo (por id ou nome) */
function removerLocalDoCatalogoFutebol(idOuNome) {
    var u = typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null;
    if (typeof podeGerenciarAgendaFutebol === 'function' && !podeGerenciarAgendaFutebol(u)) {
        return { sucesso: false, mensagem: 'Sem permissão.' };
    }
    var chave = String(idOuNome || '').trim();
    if (!chave) return { sucesso: false, mensagem: 'Informe o local.' };
    var lista = lerCatalogoLocaisFutebol();
    var antes = lista.length;
    lista = lista.filter(function (x) {
        if (!x) return false;
        if (String(x.id) === chave) return false;
        if (String(x.nome || '').toLowerCase() === chave.toLowerCase()) return false;
        return true;
    });
    if (lista.length === antes) return { sucesso: false, mensagem: 'Local não encontrado.' };
    salvarCatalogoLocaisFutebol(lista);
    return { sucesso: true, mensagem: 'Local removido do catálogo.' };
}

/** Inclui ou atualiza um local nomeado no catálogo */
function registrarLocalNoCatalogoFutebol(dados) {
    var nome = String((dados && dados.local) || (dados && dados.nome) || '').trim();
    if (!nome) return { sucesso: false, mensagem: 'Nome do local obrigatório.' };
    var lat = (dados && dados.lat != null && dados.lat !== '') ? Number(dados.lat) : null;
    var lng = (dados && dados.lng != null && dados.lng !== '') ? Number(dados.lng) : null;
    var maps = String((dados && dados.maps) || '').trim();
    if (lat != null && lng != null && !maps) maps = 'https://www.google.com/maps?q=' + lat + ',' + lng;
    var lista = lerCatalogoLocaisFutebol();
    var key = nome.toLowerCase();
    var idx = lista.findIndex(function (x) { return x && String(x.nome || '').toLowerCase() === key; });
    var reg = {
        id: (idx >= 0 && lista[idx].id) ? lista[idx].id : ('loc_' + Date.now()),
        nome: nome,
        lat: lat,
        lng: lng,
        maps: maps,
        atualizadoEm: new Date().toISOString()
    };
    if (idx >= 0) lista[idx] = reg;
    else lista.push(reg);
    lista.sort(function (a, b) { return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'); });
    salvarCatalogoLocaisFutebol(lista);
    return { sucesso: true, registro: reg };
}
/** Usa um local do catálogo (ou da agenda antiga) para uma data de jogo */
function aplicarLocalCatalogoNaData(dataIso, localIdOuNome) {
    var u = typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null;
    if (!podeGerenciarAgendaFutebol(u)) return { sucesso: false, mensagem: 'Sem permissão.' };
    dataIso = String(dataIso || '').slice(0, 10);
    var cat = lerCatalogoLocaisFutebol();
    var item = cat.find(function (x) {
        return x && (String(x.id) === String(localIdOuNome) || String(x.nome || '').toLowerCase() === String(localIdOuNome || '').toLowerCase());
    });
    // fallback: procura em jogos antigos da agenda
    if (!item && typeof lerAgendaFutebol === 'function') {
        var ag = lerAgendaFutebol();
        var hit = ag.filter(function (x) { return x && String(x.local || '').toLowerCase() === String(localIdOuNome || '').toLowerCase(); }).pop();
        if (hit) {
            item = { nome: hit.local, lat: hit.lat, lng: hit.lng, maps: hit.maps };
            registrarLocalNoCatalogoFutebol(item);
        }
    }
    if (!item) return { sucesso: false, mensagem: 'Local não encontrado no catálogo.' };
    return salvarLocalFutebol({
        data: dataIso,
        local: item.nome,
        lat: item.lat,
        lng: item.lng,
        maps: item.maps
    });
}
/** Lista unificada: catálogo + nomes únicos já usados em jogos */
function listarLocaisFutebolParaReuso() {
    var map = {};
    lerCatalogoLocaisFutebol().forEach(function (x) {
        if (!x || !x.nome) return;
        map[String(x.nome).toLowerCase()] = {
            id: x.id,
            nome: x.nome,
            lat: x.lat,
            lng: x.lng,
            maps: x.maps,
            fonte: 'catalogo'
        };
    });
    try {
        lerAgendaFutebol().forEach(function (x) {
            if (!x || !x.local) return;
            var k = String(x.local).toLowerCase();
            if (!map[k]) {
                map[k] = {
                    id: 'ag_' + k,
                    nome: x.local,
                    lat: x.lat,
                    lng: x.lng,
                    maps: x.maps,
                    fonte: 'agenda'
                };
            }
        });
    } catch (e) {}
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
        return String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    });
}

function podeGerenciarAgendaFutebol(u) {
    u = u || (typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null);
    if (!u) {
        try { u = JSON.parse(localStorage.getItem('usuarioLogado') || 'null'); } catch (e) { u = null; }
    }
    if (!u) return false;
    // Gestão / adm — formulário de local aparece para setar/ajustar
    if (u.nivel === 'admin' || u.nivel === 'gestor') return true;
    if (typeof isAdmin === 'function' && isAdmin(u)) return true;
    if (typeof isGestor === 'function' && isGestor(u)) return true;
    var usr = String(u.usuario || '').toLowerCase();
    if (usr === 'gestor' || usr === 'admin' || usr === 'adm') return true;
    if (typeof eLiderDoMinisterio === 'function' && eLiderDoMinisterio(u, 'Homens')) return true;
    if (typeof ministeriosQueLidera === 'function') {
        var mins = ministeriosQueLidera(u) || [];
        if (mins.some(function (m) { return /homens/i.test(String(m)); })) return true;
    }
    // co-líderes: lista lideraMinisterios / cargo
    if (Array.isArray(u.lideraMinisterios) && u.lideraMinisterios.some(function (m) { return /homens/i.test(String(m)); })) return true;
    if (u.lideraMinisterio && /homens/i.test(String(u.lideraMinisterio))) return true;
    var mins2 = Array.isArray(u.ministerios) ? u.ministerios : [];
    var cargo = ((u.cargo || '') + ' ' + (u.funcaoEspecifica || '') + ' ' + (u.nivel || '')).toLowerCase();
    if ((/l[ií]der/.test(cargo) || u.nivel === 'lider_ministerio') && mins2.some(function (m) { return /homens/i.test(String(m)); })) return true;
    return false;
}
/** Retorna registro { data, local, endereco, maps, obs, autorNome } ou null */
function localFutebolNaData(dataIso) {
    dataIso = String(dataIso || '').slice(0, 10);
    if (!dataIso) return null;
    var lista = lerAgendaFutebol();
    var hit = lista.find(function (x) { return x && String(x.data).slice(0, 10) === dataIso; });
    return hit || null;
}
function textoLocalFutebolParaData(dataIso) {
    var r = localFutebolNaData(dataIso);
    if (!r) return 'Local ainda não definido — procure o líder do ministério de Homens.';
    // Nome do campo é o principal; GPS fica no "Como Chegar"
    if (r.local && String(r.local).trim()) {
        var extra = '';
        if (r.obs && r.obs !== r.local) extra = ' — ' + r.obs;
        return String(r.local).trim() + extra;
    }
    if (r.endereco && String(r.endereco).trim()) return String(r.endereco).trim();
    if (r.maps || (r.lat != null && r.lng != null)) return 'Local no mapa (sem nome do campo)';
    return 'Local ainda não definido — procure o líder do ministério de Homens.';
}
function _coordsQuaseIguais(aLat, aLng, bLat, bLng) {
    if (aLat == null || aLng == null || bLat == null || bLng == null) return false;
    // ~15 metros
    return Math.abs(Number(aLat) - Number(bLat)) < 0.00015 && Math.abs(Number(aLng) - Number(bLng)) < 0.00015;
}
function salvarLocalFutebol(dados) {
    var u = typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null;
    if (!u) {
        try { u = JSON.parse(localStorage.getItem('usuarioLogado') || 'null'); } catch (e) { u = null; }
    }
    if (!podeGerenciarAgendaFutebol(u)) return { sucesso: false, mensagem: 'Sem permissão. Líder do ministério de Homens, admin ou gestor.' };
    var data = String((dados && dados.data) || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { sucesso: false, mensagem: 'Informe a data do jogo.' };
    var local = String((dados && dados.local) || '').trim();
    var endereco = String((dados && dados.endereco) || '').trim();
    var maps = String((dados && dados.maps) || '').trim();
    var lat = (dados && dados.lat != null && dados.lat !== '') ? Number(dados.lat) : null;
    var lng = (dados && dados.lng != null && dados.lng !== '') ? Number(dados.lng) : null;
    if (lat != null && lng != null && !maps) maps = 'https://www.google.com/maps?q=' + lat + ',' + lng;
    if (!local && !maps && (lat == null || lng == null)) {
        return { sucesso: false, mensagem: 'Informe o nome do local e, se possível, use o GPS no campo.' };
    }
    if (!local) return { sucesso: false, mensagem: 'Informe o nome do campo / local para salvar junto com a localização.' };
    var lista = lerAgendaFutebol();
    var idx = lista.findIndex(function (x) { return x && String(x.data).slice(0, 10) === data; });
    var anterior = idx >= 0 ? lista[idx] : null;
    // Se já existe e GPS/nome são iguais → não grava de novo
    if (anterior) {
        var mesmoNome = String(anterior.local || '').trim().toLowerCase() === local.toLowerCase();
        var mesmoGps = _coordsQuaseIguais(anterior.lat, anterior.lng, lat, lng);
        if (mesmoNome && (mesmoGps || (lat == null && anterior.lat == null))) {
            return {
                sucesso: true,
                inalterado: true,
                mensagem: 'Localização igual à anterior — nada a alterar.',
                registro: anterior
            };
        }
    }
    var historico = (anterior && Array.isArray(anterior.historico)) ? anterior.historico.slice() : [];
    if (anterior && (anterior.lat != null || anterior.local)) {
        historico.push({
            local: anterior.local,
            lat: anterior.lat,
            lng: anterior.lng,
            maps: anterior.maps,
            em: anterior.atualizadoEm || null
        });
        // limita histórico
        if (historico.length > 12) historico = historico.slice(-12);
    }
    var reg = {
        data: data,
        local: local,
        endereco: endereco,
        maps: maps,
        lat: lat,
        lng: lng,
        obs: String((dados && dados.obs) || endereco || '').trim(),
        historico: historico,
        autorId: u && u.id,
        autorNome: (u && (u.nome || u.usuario)) || '',
        atualizadoEm: new Date().toISOString()
    };
    if (idx >= 0) lista[idx] = reg;
    else lista.push(reg);
    lista.sort(function (a, b) { return String(a.data).localeCompare(String(b.data)); });
    salvarAgendaFutebol(lista);
    // Também guarda no catálogo para reutilizar em outras datas
    try {
        if (typeof registrarLocalNoCatalogoFutebol === 'function') {
            registrarLocalNoCatalogoFutebol({ local: local, lat: lat, lng: lng, maps: maps });
        }
    } catch (eCat) {}
    return {
        sucesso: true,
        inalterado: false,
        mensagem: anterior
            ? 'Localização atualizada (era diferente da anterior).'
            : 'Local salvo na lista (e no catálogo para reutilizar).',
        registro: reg
    };
}
function removerLocalFutebol(dataIso) {
    var u = typeof getUsuarioLogado === 'function' ? getUsuarioLogado() : null;
    if (!podeGerenciarAgendaFutebol(u)) return { sucesso: false, mensagem: 'Sem permissão.' };
    dataIso = String(dataIso || '').slice(0, 10);
    var lista = lerAgendaFutebol().filter(function (x) { return String(x.data).slice(0, 10) !== dataIso; });
    salvarAgendaFutebol(lista);
    return { sucesso: true, mensagem: 'Removido.' };
}
/** Próximas segundas a partir de hoje (inclui hoje se segunda) */
function proximasSegundas(qtd) {
    qtd = qtd || 8;
    var out = [];
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    // avança até segunda (1)
    var guard = 0;
    while (d.getDay() !== 1 && guard < 8) { d.setDate(d.getDate() + 1); guard++; }
    for (var i = 0; i < qtd; i++) {
        var x = new Date(d.getTime());
        x.setDate(d.getDate() + (i * 7));
        var iso = x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
        out.push(iso);
    }
    return out;
}
function textoLocalSabadoCelulasHoje() {
    try {
        var raw = localStorage.getItem('ibn_locais_celulas_sabado');
        var todos = raw ? JSON.parse(raw) : {};
        var partes = [];
        ['adolescentes', 'jovens'].forEach(function (id) {
            var L = todos[id];
            if (!L) return;
            var nome = id === 'adolescentes' ? 'Adolescentes' : 'Jovens';
            var t = (L.anfitriao || L.local || '') + (L.endereco ? ' — ' + L.endereco : '');
            if (t.trim()) partes.push(nome + ': ' + t.trim());
        });
        if (!partes.length) return 'Local das células de sábado ainda não definido pelo líder — procure o líder da célula.';
        return partes.join(' · ');
    } catch (e) {
        return 'Local das células de sábado ainda não definido pelo líder — procure o líder da célula.';
    }
}

// ---------- PEDIDOS DE ORAÇÃO (Intercessão + gestor + secretaria) ----------
function lerPedidosOracao() {
    try { return JSON.parse(localStorage.getItem(CHAVE_ORACOES) || '[]'); }
    catch (e) { return []; }
}

function salvarPedidosOracao(lista) {
    localStorage.setItem(CHAVE_ORACOES, JSON.stringify(lista));
}

/** Quem vê a lista: gestor, secretaria (admin), líder do ministério Intercessão */
function podeVerPedidosOracao(u) {
    u = u || getUsuarioLogado();
    if (!u) return false;
    if (isAdmin(u)) return true; // gestor + secretaria
    if (u.nivel === 'lider_ministerio') {
        const mins = Array.isArray(u.ministerios) ? u.ministerios : [];
        return mins.some(function (m) {
            return String(m).toLowerCase().indexOf('intercess') !== -1;
        });
    }
    // Cargo/função mencionando intercessão
    const blob = ((u.cargo || '') + ' ' + (u.funcaoEspecifica || '')).toLowerCase();
    if (blob.indexOf('intercess') !== -1) return true;
    return false;
}

/** WhatsApp da igreja para avisar a intercessão (número em formato internacional, só dígitos) */
const WHATSAPP_INTERCESSAO = '5565996292021';

function montarLinkWhatsAppOracao(item) {
    const texto =
        '*Pedido de oração — IBN Diamantino*%0A%0A' +
        '*Nome:* ' + encodeURIComponent(item.nome || '') + '%0A' +
        (item.email ? ('*Contato:* ' + encodeURIComponent(item.email) + '%0A') : '') +
        (item.membroId ? '*Membro cadastrado:* sim%0A' : '*Visitante do site*%0A') +
        '%0A*Pedido:*%0A' + encodeURIComponent(item.pedido || '');
    return 'https://wa.me/' + WHATSAPP_INTERCESSAO + '?text=' + texto;
}

function registrarPedidoOracao(dados) {
    const nome = (dados.nome || '').trim();
    const email = (dados.email || '').trim().toLowerCase();
    const pedido = (dados.pedido || '').trim();
    if (!nome || nome.length < 2) {
        return { sucesso: false, mensagem: 'Informe pelo menos o primeiro nome ou um apelido — para orarmos por alguém de verdade.' };
    }
    if (!pedido || pedido.length < 5) {
        return { sucesso: false, mensagem: 'Escreva o pedido de oração.' };
    }

    const logado = (typeof getUsuarioLogado === 'function') ? getUsuarioLogado() : null;
    const item = {
        id: 'oracao-' + Date.now(),
        nome: nome,
        email: email || (logado && logado.email) || '',
        pedido: pedido,
        membroId: logado ? (logado.id || '') : '',
        membroLogado: !!logado,
        status: 'novo',
        criadoEm: new Date().toISOString(),
        atualizadoEm: new Date().toISOString()
    };
    const lista = lerPedidosOracao();
    lista.unshift(item);
    salvarPedidosOracao(lista);

    try {
        if (typeof IBNNuvem !== 'undefined') {
            if (IBNNuvem.salvarPedidoOracao) IBNNuvem.salvarPedidoOracao(item);
            if (IBNNuvem.registrarAtividade) {
                IBNNuvem.registrarAtividade('pedido_oracao', 'Novo pedido de oração', getUsuarioLogado() || { nome: nome });
            }
        }
    } catch (e) {}

    return {
        sucesso: true,
        pedido: item,
        whatsappUrl: montarLinkWhatsAppOracao(item)
    };
}

function atualizarStatusPedidoOracao(id, status) {
    if (!podeVerPedidosOracao()) return { sucesso: false, mensagem: 'Sem permissão.' };
    const lista = lerPedidosOracao();
    const idx = lista.findIndex(function (p) { return String(p.id) === String(id); });
    if (idx === -1) return { sucesso: false, mensagem: 'Pedido não encontrado.' };
    lista[idx].status = status;
    lista[idx].atualizadoEm = new Date().toISOString();
    salvarPedidosOracao(lista);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.salvarPedidoOracao) {
            IBNNuvem.salvarPedidoOracao(lista[idx]);
        }
    } catch (e) {}
    return { sucesso: true };
}

/**
 * Transfere a titularidade de gestor para outro membro cadastrado.
 * Só o gestor atual (ou conta master gestor) pode fazer.
 * O gestor atual vira admin (secretaria), salvo se for a conta master de bootstrap.
 */
function transferirTitularidadeGestor(novoGestorMembroId) {
    const atual = getUsuarioLogado();
    if (!isGestorMaster(atual)) {
        return { sucesso: false, mensagem: 'Somente o Gestor Master pode transferir a titularidade.' };
    }
    const lista = lerMembros();
    const idxNovo = lista.findIndex(function (m) { return String(m.id) === String(novoGestorMembroId); });
    if (idxNovo === -1) return { sucesso: false, mensagem: 'Membro não encontrado.' };
    if (lista[idxNovo].nivel === 'gestor') {
        return { sucesso: false, mensagem: 'Esta pessoa já é gestor.' };
    }

    // Máx. 2 gestores membros: se já houver 2, rebaixa os outros; se houver 1, só promove o novo (fica 2)
    var outrosGestores = lista.filter(function (m) {
        return m.nivel === 'gestor' && !ehContaMasterSistema(m) && String(m.id) !== String(lista[idxNovo].id);
    });
    if (outrosGestores.length >= LIMITE_GESTORES) {
        // já no limite — rebaixa todos os outros para abrir vaga
        lista.forEach(function (m, i) {
            if (m.nivel === 'gestor' && !ehContaMasterSistema(m) && String(m.id) !== String(lista[idxNovo].id)) {
                lista[i].nivel = 'admin';
                lista[i].cargo = lista[i].cargo || 'Ex-gestor / Secretaria';
            }
        });
    } else if (outrosGestores.length === LIMITE_GESTORES - 1) {
        // 1 já existe: promover o novo atinge o limite 2 — ok, não rebaixa
    } else {
        // 0 gestores: só promove
    }

    lista[idxNovo].nivel = 'gestor';
    lista[idxNovo].cargo = 'Pastor / Gestor';
    lista[idxNovo].status = 'aprovado';
    if (typeof marcarMembroAtualizado === 'function') marcarMembroAtualizado(lista[idxNovo]);
    salvarMembros(lista);
    try { enviarMembroParaNuvem(lista[idxNovo]); } catch (e) {}

    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.registrarAtividade) {
            IBNNuvem.registrarAtividade(
                'transferir_gestor',
                'Titularidade de gestor transferida para ' + lista[idxNovo].nome,
                atual
            );
        }
    } catch (e) {}

    // Se o logado era um membro-gestor, atualiza sessão; master continua master
    if (atual && atual.id && String(atual.id) === String(lista.find(function(m){ return m.nivel==='admin' && m.email===atual.email; }) || {}).id) {
        const eu = lista.find(function (m) { return String(m.id) === String(atual.id); });
        if (eu) iniciarSessao(eu);
    }

    return {
        sucesso: true,
        mensagem: 'Titularidade transferida para ' + lista[idxNovo].nome + '. A conta master gestor@ continua como acesso de emergência/controle.',
        novoGestor: lista[idxNovo]
    };
}



// ========== ESCALA DA REUNIÃO DE CÉLULA ==========
const CHAVE_ESCALA_CELULAS = 'ibn_escala_celulas';

/** Modelo padrão de tempos da reunião de célula */
const MODELO_ESCALA_CELULA = [
    { id: 'oracao_inicial', nome: 'Oração inicial', minutos: 2 },
    { id: 'louvor', nome: 'Louvor', minutos: 8 },
    { id: 'quebra_gelo', nome: 'Quebra Gelo', minutos: 10 },
    { id: 'oferta', nome: 'Oferta', minutos: 5 },
    { id: 'palavra', nome: 'Palavra', minutos: 30 },
    { id: 'oracao_final', nome: 'Oração final e Avisos', minutos: 5 }
];

function lerTodasEscalasCelulas() {
    try { return JSON.parse(localStorage.getItem(CHAVE_ESCALA_CELULAS) || '{}'); }
    catch (e) { return {}; }
}
function salvarTodasEscalasCelulas(obj) {
    localStorage.setItem(CHAVE_ESCALA_CELULAS, JSON.stringify(obj || {}));
}
function lerEscalaCelula(celulaId) {
    var all = lerTodasEscalasCelulas();
    var arr = all[celulaId] || [];
    return Array.isArray(arr) ? arr : [];
}
function salvarEscalaCelula(celulaId, linhas) {
    var all = lerTodasEscalasCelulas();
    all[celulaId] = Array.isArray(linhas) ? linhas : [];
    salvarTodasEscalasCelulas(all);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.sincronizarEscalaCelula) {
            IBNNuvem.sincronizarEscalaCelula(celulaId, all[celulaId]).then(function (r) {
                if (r && r.sucesso === false && typeof avisarFalhaNuvem === 'function') {
                    avisarFalhaNuvem('escala da célula', r.mensagem);
                }
            }).catch(function () {});
        }
    } catch (e) {}
}

/** Líder da célula ou líder em treinamento (admin/gestor também) */
function podeEditarEscalaCelula(celulaId) {
    var u = getUsuarioLogado();
    if (!u) return false;
    if (isAdmin(u) || isGestor(u)) return true;
    if (isLiderCelula(u, celulaId)) return true;
    // líder em treinamento explícito
    if (Array.isArray(u.celulas)) {
        return u.celulas.some(function (c) {
            var id = typeof idCelulaDe === 'function' ? idCelulaDe(c) : (c && c.id);
            if (String(id) !== String(celulaId)) return false;
            var papel = String(c.papel || c.funcao || '').toLowerCase();
            var papeis = Array.isArray(c.papeis) ? c.papeis.map(function (x) { return String(x).toLowerCase(); }) : [];
            return papel.indexOf('treino') !== -1 || papel.indexOf('treinamento') !== -1 ||
                papeis.indexOf('lider_treino') !== -1 || papeis.indexOf('lider_em_treinamento') !== -1;
        });
    }
    return false;
}

/**
 * Quem pode ser escalado: integrantes da célula (líder → visitante)
 * e visitantes assíduos cadastrados na célula / com celulaId.
 */
function pessoasEscalaveisCelula(celulaId) {
    var porNome = {};
    function add(p) {
        if (!p || !p.nome) return;
        var k = String(p.nome).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        if (!k) return;
        if (!porNome[k]) porNome[k] = p;
    }
    // membros e visitantes vinculados à célula no cadastro
    var membros = (typeof membrosDaCelula === 'function') ? membrosDaCelula(celulaId) : [];
    membros.forEach(function (m) {
        if (typeof isContaSistema === 'function' && isContaSistema(m)) return;
        var tipo = (m.status === 'visitante' || m.tipo === 'visitante') ? 'visitante' : 'membro';
        add({
            id: m.id,
            nome: m.nome,
            telefone: m.telefone || '',
            tipo: tipo,
            origem: 'membro'
        });
    });
    // visitantes da base de acolhimento ligados a esta célula
    try {
        var vis = (typeof lerVisitantes === 'function') ? lerVisitantes() : [];
        vis.forEach(function (v) {
            var cid = v.celulaId || v.celula || '';
            if (cid && String(cid) !== String(celulaId)) return;
            // se não tem celulaId, só inclui se observações mencionam — melhor exigir vínculo
            if (!cid) return;
            add({
                id: v.id,
                nome: v.nome,
                telefone: v.telefone || '',
                tipo: 'visitante',
                origem: 'visitante'
            });
        });
    } catch (e) {}
    return Object.keys(porNome).map(function (k) { return porNome[k]; })
        .sort(function (a, b) { return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'); });
}

function salvarDiaEscalaCelula(dados) {
    var celulaId = dados.celulaId;
    if (!celulaId) return { sucesso: false, mensagem: 'Célula não informada.' };
    if (!podeEditarEscalaCelula(celulaId)) {
        return { sucesso: false, mensagem: 'Só o líder da célula ou líder em treinamento pode montar a escala.' };
    }
    var dataIso = dados.dataIso || '';
    var dataLabel = dados.dataLabel || dataIso;
    if (!dataIso && dataLabel && typeof parseDataEscalaLabel === 'function') {
        var pd = parseDataEscalaLabel(dataLabel);
        if (pd) dataIso = pd.iso;
    }
    if (!dataIso) return { sucesso: false, mensagem: 'Informe a data da reunião.' };

    var funcoes = dados.funcoes || {};
    // garante chaves do modelo
    MODELO_ESCALA_CELULA.forEach(function (f) {
        if (!funcoes[f.nome]) funcoes[f.nome] = [];
        if (!Array.isArray(funcoes[f.nome])) funcoes[f.nome] = [String(funcoes[f.nome])].filter(Boolean);
    });

    var status = dados.status === 'finalizada' ? 'finalizada' : 'rascunho';
    var linhas = lerEscalaCelula(celulaId);
    var idx = linhas.findIndex(function (l) {
        return String(l.dataIso || '') === String(dataIso) || String(l.dataLabel || '') === String(dataLabel);
    });
    var linha = {
        dataIso: dataIso,
        dataLabel: dataLabel,
        funcoes: funcoes,
        observacao: String(dados.observacao || '').trim(),
        status: status,
        celulaId: celulaId,
        tema: dados.tema || 'areia',
        versiculo: dados.versiculo || null,
        atualizadoEm: new Date().toISOString(),
        atualizadoPor: (getUsuarioLogado() || {}).nome || ''
    };
    if (idx >= 0) linhas[idx] = Object.assign({}, linhas[idx], linha);
    else linhas.push(linha);
    linhas.sort(function (a, b) {
        return String(a.dataIso || a.dataLabel).localeCompare(String(b.dataIso || b.dataLabel));
    });
    salvarEscalaCelula(celulaId, linhas);
    try {
        if (typeof IBNNuvem !== 'undefined' && IBNNuvem.registrarAtividade) {
            IBNNuvem.registrarAtividade('escala_celula', (status === 'finalizada' ? 'Finalizou' : 'Salvou rascunho de') + ' escala célula ' + celulaId + ' ' + dataLabel, getUsuarioLogado());
        }
    } catch (e) {}
    return { sucesso: true, linha: linha, linhas: linhas, mensagem: status === 'finalizada' ? 'Escala finalizada.' : 'Rascunho salvo.' };
}

function removerDiaEscalaCelula(celulaId, dataIso) {
    if (!podeEditarEscalaCelula(celulaId)) return { sucesso: false, mensagem: 'Sem permissão.' };
    var linhas = lerEscalaCelula(celulaId).filter(function (l) {
        return String(l.dataIso || '') !== String(dataIso);
    });
    salvarEscalaCelula(celulaId, linhas);
    return { sucesso: true };
}


/** Versículos padrão / salvos por ministério e célula */

// ========== BÍBLIA (busca de versículo por versão — NVI padrão) ==========
const BIBLIA_VERSOES = [
    { id: 'nvi', nome: 'NVI — Nova Versão Internacional' },
    { id: 'naa', nome: 'NAA — Nova Almeida Atualizada' },
    { id: 'acf', nome: 'ACF — Almeida Corrigida Fiel' }
];

const BIBLIA_LIVROS = {
    'genesis': 'gn', 'gênesis': 'gn', 'gn': 'gn', 'gen': 'gn',
    'exodo': 'ex', 'êxodo': 'ex', 'ex': 'ex',
    'levitico': 'lv', 'levítico': 'lv', 'lv': 'lv',
    'numeros': 'nm', 'números': 'nm', 'nm': 'nm',
    'deuteronomio': 'dt', 'deuteronômio': 'dt', 'dt': 'dt',
    'josue': 'js', 'josué': 'js', 'js': 'js',
    'juizes': 'jz', 'juízes': 'jz', 'jz': 'jz',
    'rute': 'rt', 'rt': 'rt',
    '1 samuel': '1sm', '1samuel': '1sm', '1sm': '1sm', 'i samuel': '1sm',
    '2 samuel': '2sm', '2samuel': '2sm', '2sm': '2sm',
    '1 reis': '1rs', '1reis': '1rs', '1rs': '1rs',
    '2 reis': '2rs', '2reis': '2rs', '2rs': '2rs',
    '1 cronicas': '1cr', '1crônicas': '1cr', '1cr': '1cr',
    '2 cronicas': '2cr', '2crônicas': '2cr', '2cr': '2cr',
    'esdras': 'ed', 'ed': 'ed',
    'neemias': 'ne', 'ne': 'ne',
    'ester': 'et', 'et': 'et',
    'jo': 'job', 'jó': 'job', 'job': 'job',
    'salmos': 'sl', 'salmo': 'sl', 'sl': 'sl', 'ps': 'sl',
    'proverbios': 'pv', 'provérbios': 'pv', 'pv': 'pv',
    'eclesiastes': 'ec', 'ec': 'ec',
    'cantares': 'ct', 'cantico': 'ct', 'cântico': 'ct', 'ct': 'ct',
    'isaias': 'is', 'isaías': 'is', 'is': 'is',
    'jeremias': 'jr', 'jr': 'jr',
    'lamentacoes': 'lm', 'lamentações': 'lm', 'lm': 'lm',
    'ezequiel': 'ez', 'ez': 'ez',
    'daniel': 'dn', 'dn': 'dn',
    'oseias': 'os', 'oséias': 'os', 'os': 'os',
    'joel': 'jl', 'jl': 'jl',
    'amos': 'am', 'amós': 'am', 'am': 'am',
    'obadias': 'ob', 'ob': 'ob',
    'jonas': 'jn', 'jn': 'jn',
    'miqueias': 'mq', 'mq': 'mq',
    'naum': 'na', 'na': 'na',
    'habacuque': 'hc', 'hc': 'hc',
    'sofonias': 'sf', 'sf': 'sf',
    'ageu': 'ag', 'ag': 'ag',
    'zacarias': 'zc', 'zc': 'zc',
    'malaquias': 'ml', 'ml': 'ml',
    'mateus': 'mt', 'mt': 'mt', 'mat': 'mt',
    'marcos': 'mc', 'mc': 'mc', 'mr': 'mc',
    'lucas': 'lc', 'lc': 'lc',
    'joao': 'jo', 'joão': 'jo', 'jo': 'jo',
    'atos': 'at', 'at': 'at',
    'romanos': 'rm', 'rm': 'rm', 'rom': 'rm',
    '1 corintios': '1co', '1corintios': '1co', '1 coríntios': '1co', '1co': '1co',
    '2 corintios': '2co', '2corintios': '2co', '2 coríntios': '2co', '2co': '2co',
    'galatas': 'gl', 'gálatas': 'gl', 'gl': 'gl',
    'efesios': 'ef', 'efésios': 'ef', 'ef': 'ef',
    'filipenses': 'fp', 'fp': 'fp',
    'colossenses': 'cl', 'cl': 'cl',
    '1 tessalonicenses': '1ts', '1tessalonicenses': '1ts', '1ts': '1ts',
    '2 tessalonicenses': '2ts', '2tessalonicenses': '2ts', '2ts': '2ts',
    '1 timoteo': '1tm', '1timoteo': '1tm', '1 timóteo': '1tm', '1tm': '1tm',
    '2 timoteo': '2tm', '2timoteo': '2tm', '2 timóteo': '2tm', '2tm': '2tm',
    'tito': 'tt', 'tt': 'tt',
    'filemom': 'fm', 'fm': 'fm',
    'hebreus': 'hb', 'hb': 'hb',
    'tiago': 'tg', 'tg': 'tg',
    '1 pedro': '1pe', '1pedro': '1pe', '1pe': '1pe',
    '2 pedro': '2pe', '2pedro': '2pe', '2pe': '2pe',
    '1 joao': '1jo', '1joao': '1jo', '1 joão': '1jo', '1jo': '1jo',
    '2 joao': '2jo', '2joao': '2jo', '2 joão': '2jo', '2jo': '2jo',
    '3 joao': '3jo', '3joao': '3jo', '3 joão': '3jo', '3jo': '3jo',
    'judas': 'jd', 'jd': 'jd',
    'apocalipse': 'ap', 'ap': 'ap', 'apo': 'ap'
};

/** Nomes de exibição do livro a partir da abreviação */
const BIBLIA_NOME_LIVRO = {
    gn: 'Gênesis', ex: 'Êxodo', lv: 'Levítico', nm: 'Números', dt: 'Deuteronômio',
    js: 'Josué', jz: 'Juízes', rt: 'Rute', '1sm': '1 Samuel', '2sm': '2 Samuel',
    '1rs': '1 Reis', '2rs': '2 Reis', '1cr': '1 Crônicas', '2cr': '2 Crônicas',
    ed: 'Esdras', ne: 'Neemias', et: 'Ester', job: 'Jó', sl: 'Salmos', pv: 'Provérbios',
    ec: 'Eclesiastes', ct: 'Cânticos', is: 'Isaías', jr: 'Jeremias', lm: 'Lamentações',
    ez: 'Ezequiel', dn: 'Daniel', os: 'Oséias', jl: 'Joel', am: 'Amós', ob: 'Obadias',
    jn: 'Jonas', mq: 'Miquéias', na: 'Naum', hc: 'Habacuque', sf: 'Sofonias', ag: 'Ageu',
    zc: 'Zacarias', ml: 'Malaquias', mt: 'Mateus', mc: 'Marcos', lc: 'Lucas', jo: 'João',
    at: 'Atos', rm: 'Romanos', '1co': '1 Coríntios', '2co': '2 Coríntios', gl: 'Gálatas',
    ef: 'Efésios', fp: 'Filipenses', cl: 'Colossenses', '1ts': '1 Tessalonicenses',
    '2ts': '2 Tessalonicenses', '1tm': '1 Timóteo', '2tm': '2 Timóteo', tt: 'Tito',
    fm: 'Filemom', hb: 'Hebreus', tg: 'Tiago', '1pe': '1 Pedro', '2pe': '2 Pedro',
    '1jo': '1 João', '2jo': '2 João', '3jo': '3 João', jd: 'Judas', ap: 'Apocalipse'
};

/**
 * Banco local NVI + ACF (funciona sem internet).
 * Chave: livro/capitulo/verso  ex: mt/18/20
 */
const BIBLIA_LOCAL = {
    'mt/18/20': {
        nvi: 'Pois onde se reunirem dois ou três em meu nome, ali eu estou no meio deles.',
        acf: 'Porque, onde estiverem dois ou três reunidos em meu nome, aí estou eu no meio deles.'
    },
    'mt/18/24': {
        nvi: 'Quando começou a acertar as contas, foi trazido à sua presença um que lhe devia dez mil talentos.',
        acf: 'E, começando a contar, foi-lhe apresentado um que lhe devia dez mil talentos.'
    },
    'mt/28/19': {
        nvi: 'Portanto, vão e façam discípulos de todas as nações, batizando-os em nome do Pai e do Filho e do Espírito Santo.',
        acf: 'Portanto ide, fazei discípulos de todas as nações, batizando-os em nome do Pai, e do Filho, e do Espírito Santo.'
    },
    'mt/28/20': {
        nvi: 'Ensinando-os a obedecer a tudo o que eu ordenei a vocês. E eu estarei sempre com vocês, até o fim dos tempos.',
        acf: 'Ensinando-os a guardar todas as coisas que eu vos tenho mandado; e eis que eu estou convosco todos os dias, até a consumação dos séculos. Amém.'
    },
    'mt/5/16': {
        nvi: 'Assim brilhe a luz de vocês diante dos homens, para que vejam as suas boas obras e glorifiquem a seu Pai que está nos céus.',
        acf: 'Assim resplandeça a vossa luz diante dos homens, para que vejam as vossas boas obras e glorifiquem a vosso Pai, que está nos céus.'
    },
    'mt/6/33': {
        nvi: 'Busquem, pois, em primeiro lugar o Reino de Deus e a sua justiça, e todas essas coisas lhes serão acrescentadas.',
        acf: 'Mas, buscai primeiro o Reino de Deus, e a sua justiça, e todas essas coisas vos serão acrescentadas.'
    },
    'mt/11/28': {
        nvi: 'Venham a mim, todos os que estão cansados e sobrecarregados, e eu darei descanso a vocês.',
        acf: 'Vinde a mim, todos os que estais cansados e oprimidos, e eu vos aliviarei.'
    },
    'jo/3/16': {
        nvi: 'Porque Deus tanto amou o mundo que deu o seu Filho Unigênito, para que todo o que nele crer não pereça, mas tenha a vida eterna.',
        acf: 'Porque Deus amou o mundo de tal maneira que deu o seu Filho unigênito, para que todo aquele que nele crê não pereça, mas tenha a vida eterna.'
    },
    'jo/14/6': {
        nvi: 'Respondeu Jesus: Eu sou o caminho, a verdade e a vida. Ninguém vem ao Pai, a não ser por mim.',
        acf: 'Disse-lhe Jesus: Eu sou o caminho, e a verdade e a vida; ninguém vem ao Pai, senão por mim.'
    },
    'jo/13/35': {
        nvi: 'Com isso todos saberão que vocês são meus discípulos, se vocês se amarem uns aos outros.',
        acf: 'Nisto todos conhecerão que sois meus discípulos, se vos amardes uns aos outros.'
    },
    '1pe/4/10': {
        nvi: 'Cada um exerça o dom que recebeu para servir aos outros, administrando fielmente a graça de Deus em suas múltiplas formas.',
        acf: 'Cada um administre aos outros o dom como o recebeu, como bons despenseiros da multiforme graça de Deus.'
    },
    '1pe/5/7': {
        nvi: 'Lancem sobre ele toda a sua ansiedade, porque ele tem cuidado de vocês.',
        acf: 'Lançando sobre ele toda a vossa ansiedade, porque ele tem cuidado de vós.'
    },
    'rm/8/28': {
        nvi: 'Sabemos que Deus age em todas as coisas para o bem daqueles que o amam, dos que foram chamados de acordo com o seu propósito.',
        acf: 'E sabemos que todas as coisas contribuem juntamente para o bem daqueles que amam a Deus, daqueles que são chamados segundo o seu propósito.'
    },
    'rm/12/1': {
        nvi: 'Portanto, irmãos, rogo-lhes pelas misericórdias de Deus que se ofereçam em sacrifício vivo, santo e agradável a Deus; este é o culto racional de vocês.',
        acf: 'Rogo-vos, pois, irmãos, pela compaixão de Deus, que apresenteis os vossos corpos em sacrifício vivo, santo e agradável a Deus, que é o vosso culto racional.'
    },
    'rm/12/2': {
        nvi: 'Não se amoldem ao padrão deste mundo, mas transformem-se pela renovação da sua mente, para que sejam capazes de experimentar e comprovar a boa, agradável e perfeita vontade de Deus.',
        acf: 'E não vos conformeis com este mundo, mas transformai-vos pela renovação da vossa mente, para que experimenteis qual seja a boa, agradável, e perfeita vontade de Deus.'
    },
    'fp/4/13': {
        nvi: 'Tudo posso naquele que me fortalece.',
        acf: 'Posso todas as coisas em Cristo que me fortalece.'
    },
    'fp/4/6': {
        nvi: 'Não andem ansiosos por coisa alguma, mas em tudo, pela oração e súplicas, e com ação de graças, apresentem seus pedidos a Deus.',
        acf: 'Não estejais inquietos por coisa alguma; antes as vossas petições sejam em tudo conhecidas diante de Deus pela oração e súplica, com ação de graças.'
    },
    'fp/4/7': {
        nvi: 'E a paz de Deus, que excede todo o entendimento, guardará o coração e a mente de vocês em Cristo Jesus.',
        acf: 'E a paz de Deus, que excede todo o entendimento, guardará os vossos corações e os vossos sentimentos em Cristo Jesus.'
    },
    'sl/23/1': {
        nvi: 'O Senhor é o meu pastor; de nada terei falta.',
        acf: 'O Senhor é o meu pastor; nada me faltará.'
    },
    'sl/46/1': {
        nvi: 'Deus é o nosso refúgio e a nossa fortaleza, auxílio sempre presente na adversidade.',
        acf: 'Deus é o nosso refúgio e fortaleza, socorro bem presente na angústia.'
    },
    'sl/119/105': {
        nvi: 'A tua palavra é lâmpada que ilumina os meus passos e luz que clareia o meu caminho.',
        acf: 'Lâmpada para os meus pés é tua palavra, e luz para o meu caminho.'
    },
    'sl/37/5': {
        nvi: 'Entregue o seu caminho ao Senhor; confie nele, e ele agirá.',
        acf: 'Entrega o teu caminho ao Senhor; confia nele, e ele o fará.'
    },
    'pv/3/5': {
        nvi: 'Confie no Senhor de todo o seu coração e não se apoie em seu próprio entendimento.',
        acf: 'Confia no Senhor de todo o teu coração, e não te estribes no teu próprio entendimento.'
    },
    'pv/3/6': {
        nvi: 'Reconheça o Senhor em todos os seus caminhos, e ele endireitará as suas veredas.',
        acf: 'Reconhece-o em todos os teus caminhos, e ele endireitará as tuas veredas.'
    },
    'is/40/31': {
        nvi: 'Mas aqueles que esperam no Senhor renovam as suas forças. Voam alto como águias; correm e não ficam exaustos, andam e não se cansam.',
        acf: 'Mas os que esperam no Senhor renovarão as forças, subirão com asas como águias; correrão, e não se cansarão; caminharão, e não se fatigarão.'
    },
    'is/41/10': {
        nvi: 'Não tema, pois eu estou com você; não tenha medo, pois eu sou o seu Deus. Eu o fortalecerei e o ajudarei; eu o segurarei com a minha mão direita vitoriosa.',
        acf: 'Não temas, porque eu sou contigo; não te assombres, porque eu sou o teu Deus; eu te fortaleço, e te ajudo, e te sustento com a destra da minha justiça.'
    },
    'jr/29/11': {
        nvi: 'Porque sou eu que conheço os planos que tenho para vocês, diz o Senhor, planos de fazê-los prosperar e não de lhes causar dano, planos de dar a vocês esperança e um futuro.',
        acf: 'Porque eu bem sei os pensamentos que penso de vós, diz o Senhor; pensamentos de paz, e não de mal, para vos dar o fim que esperais.'
    },
    'hb/11/1': {
        nvi: 'Ora, a fé é a certeza daquilo que esperamos e a prova das coisas que não vemos.',
        acf: 'Ora, a fé é o firme fundamento das coisas que se esperam, e a prova das coisas que se não veem.'
    },
    'hb/13/8': {
        nvi: 'Jesus Cristo é o mesmo ontem, hoje e para sempre.',
        acf: 'Jesus Cristo é o mesmo ontem, e hoje, e eternamente.'
    },
    '2tm/3/16': {
        nvi: 'Toda a Escritura é inspirada por Deus e útil para o ensino, para a repreensão, para a correção e para a instrução na justiça.',
        acf: 'Toda a Escritura é divinamente inspirada, e proveitosa para ensinar, para redarguir, para corrigir, para instruir em justiça.'
    },
    '2tm/1/7': {
        nvi: 'Pois Deus não nos deu espírito de covardia, mas de poder, de amor e de equilíbrio.',
        acf: 'Porque Deus não nos deu o espírito de temor, mas de fortaleza, e de amor, e de moderação.'
    },
    'ef/2/8': {
        nvi: 'Pois vocês são salvos pela graça, por meio da fé, e isto não vem de vocês, é dom de Deus.',
        acf: 'Porque pela graça sois salvos, por meio da fé; e isto não vem de vós, é dom de Deus.'
    },
    'ef/4/32': {
        nvi: 'Sejam bondosos e compassivos uns para com os outros, perdoando-se mutuamente, assim como Deus os perdoou em Cristo.',
        acf: 'Antes sede uns para com os outros benignos, misericordiosos, perdoando-vos uns aos outros, como também Deus vos perdoou em Cristo.'
    },
    'ef/6/10': {
        nvi: 'Finalmente, fortaleçam-se no Senhor e no seu forte poder.',
        acf: 'No demais, irmãos meus, fortalecei-vos no Senhor e na força do seu poder.'
    },
    'gl/5/22': {
        nvi: 'Mas o fruto do Espírito é amor, alegria, paz, paciência, amabilidade, bondade, fidelidade.',
        acf: 'Mas o fruto do Espírito é: amor, gozo, paz, longanimidade, benignidade, bondade, fé, mansidão, temperança.'
    },
    'gl/6/9': {
        nvi: 'E não nos cansemos de fazer o bem, pois no tempo próprio colheremos, se não desanimarmos.',
        acf: 'E não nos cansemos de fazer bem, porque a seu tempo ceifaremos, se não houvermos desfalecido.'
    },
    '1co/13/13': {
        nvi: 'Assim, permanecem agora estes três: a fé, a esperança e o amor. O maior deles, porém, é o amor.',
        acf: 'Agora, pois, permanecem a fé, a esperança e o amor, estes três, porém o maior destes é o amor.'
    },
    '1co/10/31': {
        nvi: 'Assim, quer vocês comam, quer bebam, quer façam qualquer outra coisa, façam tudo para a glória de Deus.',
        acf: 'Portanto, quer comais quer bebais, ou façais qualquer outra coisa, fazei tudo para glória de Deus.'
    },
    '1ts/5/16': {
        nvi: 'Alegrem-se sempre.',
        acf: 'Regozijai-vos sempre.'
    },
    '1ts/5/17': {
        nvi: 'Orem continuamente.',
        acf: 'Orai sem cessar.'
    },
    '1ts/5/18': {
        nvi: 'Deem graças em todas as circunstâncias, pois esta é a vontade de Deus para vocês em Cristo Jesus.',
        acf: 'Em tudo dai graças, porque esta é a vontade de Deus em Cristo Jesus para convosco.'
    },
    'tg/1/5': {
        nvi: 'Se algum de vocês tem falta de sabedoria, peça-a a Deus, que a todos dá livremente, de boa vontade; e lhe será concedida.',
        acf: 'E, se algum de vós tem falta de sabedoria, peça-a a Deus, que a todos dá liberalmente, e o não lança em rosto, e ser-lhe-á dada.'
    },
    'tg/5/16': {
        nvi: 'Portanto, confessem os seus pecados uns aos outros e orem uns pelos outros para serem curados. A oração de um justo é poderosa e eficaz.',
        acf: 'Confessai as vossas culpas uns aos outros, e orai uns pelos outros, para que sareis. A oração feita por um justo pode muito em seus efeitos.'
    },
    'at/1/8': {
        nvi: 'Mas receberão poder quando o Espírito Santo descer sobre vocês, e serão minhas testemunhas em Jerusalém, em toda a Judeia e Samaria, e até os confins da terra.',
        acf: 'Mas recebereis a virtude do Espírito Santo, que há de vir sobre vós; e ser-me-eis testemunhas, tanto em Jerusalém como em toda a Judéia e Samaria, e até aos confins da terra.'
    },
    'at/2/42': {
        nvi: 'Eles se dedicavam ao ensino dos apóstolos e à comunhão, ao partir do pão e às orações.',
        acf: 'E perseveravam na doutrina dos apóstolos, e na comunhão, e no partir do pão, e nas orações.'
    },
    'cl/3/23': {
        nvi: 'Tudo o que fizerem, façam de todo o coração, como para o Senhor, e não para os homens.',
        acf: 'E tudo quanto fizerdes, fazei-o de todo o coração, como ao Senhor, e não aos homens.'
    },
    'hb/10/25': {
        nvi: 'Não deixemos de reunir-nos como igreja, segundo o costume de alguns, mas façamos admoestações, e tanto mais quanto vedes que o dia se aproxima.',
        acf: 'Não deixando a nossa congregação, como é costume de alguns, antes admoestando-nos uns aos outros; e tanto mais, quanto vedes que se vai aproximando aquele dia.'
    },
    '2co/5/17': {
        nvi: 'Portanto, se alguém está em Cristo, é nova criação. As coisas antigas já passaram; eis que surgiram coisas novas!',
        acf: 'Assim que, se alguém está em Cristo, nova criatura é; as coisas velhas já passaram; eis que tudo se fez novo.'
    },
    '1jo/1/9': {
        nvi: 'Se confessarmos os nossos pecados, ele é fiel e justo para perdoar os nossos pecados e nos purificar de toda injustiça.',
        acf: 'Se confessarmos os nossos pecados, ele é fiel e justo para nos perdoar os pecados, e nos purificar de toda a injustiça.'
    },
    '1jo/4/8': {
        nvi: 'Quem não ama não conhece a Deus, porque Deus é amor.',
        acf: 'Aquele que não ama não conhece a Deus; porque Deus é amor.'
    },
    'ap/3/20': {
        nvi: 'Eis que estou à porta e bato. Se alguém ouvir a minha voz e abrir a porta, entrarei e cearei com ele, e ele comigo.',
        acf: 'Eis que estou à porta, e bato; se alguém ouvir a minha voz, e abrir a porta, entrarei em sua casa, e com ele cearei, e ele comigo.'
    }
};

/** Parseia "Mateus 18:20", "Mt 18:20", "1 Pedro 4:10" */
function parseReferenciaBiblica(ref) {
    var s = String(ref || '').trim();
    // remove (NVI), (ACF) etc.
    s = s.replace(/\s*\([^)]*\)\s*$/g, '').trim();
    // normaliza João / Joao
    s = s.replace(/\bjoao\b/gi, 'João');
    // aceita "João 10.10" ou "João 10:10" ou "João10:10"
    var m = s.match(/^((?:[123]\s*)?[A-Za-zÀ-ú\.]+)\s*(\d+)\s*[:\.\s]\s*(\d+)(?:\s*[-–]\s*(\d+))?/i);
    if (!m) {
        // tenta sem espaço: Mt18:20
        m = s.match(/^((?:[123])?[A-Za-zÀ-ú\.]+)(\d+)[:\.](\d+)$/i);
    }
    if (!m) return null;
    var livroRaw = m[1].replace(/\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    // remove acentos para casar joão -> joao
    var livroNorm = livroRaw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    var livroRaw2 = livroNorm.replace(/\s+/g, '');
    var abrev = BIBLIA_LIVROS[livroRaw] || BIBLIA_LIVROS[livroNorm] || BIBLIA_LIVROS[livroRaw2] || BIBLIA_LIVROS[livroRaw.replace(/\s+/g, '')];
    if (!abrev) return null;
    return {
        livro: abrev,
        capitulo: parseInt(m[2], 10),
        verso: parseInt(m[3], 10),
        versoFim: m[4] ? parseInt(m[4], 10) : null,
        refLimpa: s
    };
}

function chaveBibliaLocal(parsed) {
    return parsed.livro + '/' + parsed.capitulo + '/' + parsed.verso;
}

/** Cache em memória da Bíblia completa (NVI / ACF) — carrega 1x por sessão */
var _bibliaCacheCompleta = { nvi: null, acf: null };
var _bibliaLoadingPromise = { nvi: null, acf: null };

function carregarBibliaCompleta(versao) {
    versao = String(versao || 'nvi').toLowerCase();
    if (versao !== 'nvi' && versao !== 'acf' && versao !== 'naa') versao = 'nvi';
    if (_bibliaCacheCompleta[versao]) {
        return Promise.resolve(_bibliaCacheCompleta[versao]);
    }
    if (_bibliaLoadingPromise[versao]) {
        return _bibliaLoadingPromise[versao];
    }

    function normalizarData(data) {
        if (typeof data === 'string') {
            data = JSON.parse(data.replace(/^\uFEFF/, ''));
        }
        if (!Array.isArray(data) || !data.length) throw new Error('Arquivo da Bíblia inválido');
        return data;
    }

    function tentarFetch(url, opts) {
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = null;
        if (ctrl) {
            timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 25000);
        }
        return fetch(url, Object.assign({ method: 'GET', cache: 'force-cache' }, opts || {}, ctrl ? { signal: ctrl.signal } : {}))
            .then(function (res) {
                if (timer) clearTimeout(timer);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                if (timer) clearTimeout(timer);
                return normalizarData(data);
            })
            .catch(function (err) {
                if (timer) clearTimeout(timer);
                throw err;
            });
    }

    // 1) arquivo no próprio site (GitHub Pages / servidor)
    // 2) jsDelivr CDN
    // 3) raw GitHub
    var baseLocal = '';
    try {
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
            var src = scripts[i].src || '';
            if (src.indexOf('conta.js') !== -1) {
                baseLocal = src.replace(/conta\.js.*$/, '');
                break;
            }
        }
    } catch (e0) {}
    var urls = [
        (baseLocal || '') + 'biblia/' + versao + '.json',
        'biblia/' + versao + '.json',
        './biblia/' + versao + '.json',
        // também aceita na raiz do site (upload pelo GitHub sem pasta)
        (baseLocal || '') + versao + '.json',
        versao + '.json',
        './' + versao + '.json',
        'https://cdn.jsdelivr.net/gh/thiagobodruk/biblia@master/json/' + versao + '.json',
        'https://raw.githubusercontent.com/thiagobodruk/biblia/master/json/' + versao + '.json',
        // NAA e demais no repositório bible (pt_naa)
        'https://cdn.jsdelivr.net/gh/thiagobodruk/bible@master/json/pt_' + versao + '.json',
        'https://raw.githubusercontent.com/thiagobodruk/bible/master/json/pt_' + versao + '.json'
    ];

    _bibliaLoadingPromise[versao] = (function tentarEm(i) {
        if (i >= urls.length) {
            var fileProto = (typeof location !== 'undefined' && location.protocol === 'file:');
            var msg = fileProto
                ? 'Você abriu o site direto do computador (arquivo local). O navegador bloqueia o carregamento da Bíblia assim. Publique no GitHub Pages ou abra com um servidor local.'
                : 'Não foi possível carregar a Bíblia ' + versao.toUpperCase() + '. Verifique a internet e tente de novo.';
            _bibliaLoadingPromise[versao] = null;
            return Promise.reject(new Error(msg));
        }
        return tentarFetch(urls[i], { mode: i >= 3 ? 'cors' : 'same-origin' }).catch(function () {
            // local pode falhar com CORS mode — tenta sem mode restrito
            return tentarFetch(urls[i]).catch(function () {
                return tentarEm(i + 1);
            });
        });
    })(0).then(function (data) {
        _bibliaCacheCompleta[versao] = data;
        _bibliaLoadingPromise[versao] = null;
        return data;
    }).catch(function (err) {
        _bibliaLoadingPromise[versao] = null;
        throw err;
    });

    return _bibliaLoadingPromise[versao];
}

function extrairVersiculoDaBiblia(data, parsed) {
    if (!data || !parsed) return null;
    var livro = null;
    for (var i = 0; i < data.length; i++) {
        if (String(data[i].abbrev || '').toLowerCase() === String(parsed.livro).toLowerCase()) {
            livro = data[i];
            break;
        }
    }
    if (!livro || !Array.isArray(livro.chapters)) return null;
    var cap = livro.chapters[parsed.capitulo - 1];
    if (!cap || !Array.isArray(cap)) return null;
    var texto = cap[parsed.verso - 1];
    if (!texto) return null;
    return String(texto).trim();
}

/**
 * Busca versículo NVI ou ACF:
 * 1) banco local rápido (versículos comuns)
 * 2) Bíblia completa online (cache na memória após 1º uso)
 */
function buscarVersiculoBiblia(referencia, versao) {
    versao = String(versao || 'nvi').toLowerCase();
    if (versao !== 'nvi' && versao !== 'acf') versao = 'nvi';
    var parsed = parseReferenciaBiblica(referencia);
    if (!parsed) {
        return Promise.resolve({
            sucesso: false,
            mensagem: 'Referência inválida. Exemplos: Mateus 18:20 · João 10:10 · 1 Pedro 4:10'
        });
    }
    var nomeLivro = BIBLIA_NOME_LIVRO[parsed.livro] || parsed.livro;
    var refOut = nomeLivro + ' ' + parsed.capitulo + ':' + parsed.verso + ' (' + versao.toUpperCase() + ')';

    // 1) local rápido
    var chave = chaveBibliaLocal(parsed);
    var local = BIBLIA_LOCAL[chave];
    if (local && local[versao]) {
        return Promise.resolve({
            sucesso: true,
            texto: local[versao],
            referencia: refOut,
            versao: versao,
            mensagem: 'Atualizado: ' + refOut
        });
    }

    // 2) Bíblia completa (1ª vez baixa ~4MB e guarda na memória do navegador)
    return carregarBibliaCompleta(versao)
        .then(function (data) {
            var texto = extrairVersiculoDaBiblia(data, parsed);
            if (!texto) {
                return {
                    sucesso: false,
                    mensagem: 'Versículo não encontrado: ' + refOut + '. Confira livro, capítulo e verso.'
                };
            }
            // guarda no banco local da sessão para próxima busca instantânea
            if (!BIBLIA_LOCAL[chave]) BIBLIA_LOCAL[chave] = {};
            BIBLIA_LOCAL[chave][versao] = texto;
            return {
                sucesso: true,
                texto: texto,
                referencia: refOut,
                versao: versao,
                mensagem: 'Atualizado: ' + refOut
            };
        })
        .catch(function (err) {
            return {
                sucesso: false,
                mensagem: 'Não foi possível baixar a Bíblia (' + versao.toUpperCase() + '). Verifique a internet e tente de novo. ' +
                    ((err && err.message) ? err.message : '')
            };
        });
}

/** Preenche selects de versão da Bíblia na página */
function preencherSelectsVersaoBiblia() {
    document.querySelectorAll('select.sel-versao-biblia').forEach(function (sel) {
        var atual = sel.value || 'nvi';
        if (atual !== 'nvi' && atual !== 'acf') atual = 'nvi';
        sel.innerHTML = BIBLIA_VERSOES.map(function (v) {
            return '<option value="' + v.id + '"' + (v.id === atual ? ' selected' : '') + '>' + v.nome + '</option>';
        }).join('');
        sel.setAttribute('data-filled', '1');
    });
}

/** Liga botão Atualizar versículo (data-texto, data-ref, data-versao, data-msg opcional) */
function ligarBotaoAtualizarVersiculo(btnId) {
    var btn = document.getElementById(btnId);
    if (!btn || btn.getAttribute('data-bound') === '1') return;
    btn.setAttribute('data-bound', '1');
    btn.addEventListener('click', function () {
        var idTexto = btn.getAttribute('data-texto');
        var idRef = btn.getAttribute('data-ref');
        var idVersao = btn.getAttribute('data-versao');
        var idMsg = btn.getAttribute('data-msg');
        var elT = document.getElementById(idTexto);
        var elR = document.getElementById(idRef);
        var elV = document.getElementById(idVersao);
        var elM = idMsg ? document.getElementById(idMsg) : null;
        var ref = elR ? elR.value.trim() : '';
        var versao = elV ? elV.value : 'nvi';
        if (!ref) {
            alert('Informe a referência (ex: Mateus 18:20)');
            return;
        }
        btn.disabled = true;
        var old = btn.textContent;
        btn.textContent = 'Buscando…';
        if (elM) {
            elM.classList.remove('hidden');
            elM.className = 'text-xs text-blue-700 mt-1';
            elM.textContent = 'Buscando ' + versao.toUpperCase() + '… (na 1ª vez pode baixar a Bíblia completa; depois fica rápido)';
        }
        buscarVersiculoBiblia(ref, versao).then(function (r) {
            btn.disabled = false;
            btn.textContent = old;
            if (r.sucesso) {
                if (elT) elT.value = r.texto;
                if (elR) elR.value = r.referencia;
                if (elM) {
                    elM.className = 'text-xs text-green-700 mt-1';
                    elM.textContent = r.mensagem;
                }
            } else {
                if (elM) {
                    elM.className = 'text-xs text-red-600 mt-1';
                    elM.textContent = r.mensagem;
                } else {
                    alert(r.mensagem);
                }
            }
        });
    });
}


const CHAVE_VERSICULOS_ESCALA = 'ibn_versiculos_escala';
/** Padrão do site: NVI (Nova Versão Internacional — português Brasil) */
const VERSICULO_PADRAO = {
    texto: 'Cada um exerça o dom que recebeu para servir aos outros, administrando fielmente a graça de Deus em suas múltiplas formas.',
    referencia: '1 Pedro 4:10 (NVI)'
};
const VERSICULO_PADRAO_CELULA = {
    texto: 'Pois onde se reunirem dois ou três em meu nome, ali eu estou no meio deles.',
    referencia: 'Mateus 18:20 (NVI)'
};

function lerVersiculosEscala() {
    try { return JSON.parse(localStorage.getItem(CHAVE_VERSICULOS_ESCALA) || '{}'); }
    catch (e) { return {}; }
}
function salvarVersiculosEscala(obj) {
    localStorage.setItem(CHAVE_VERSICULOS_ESCALA, JSON.stringify(obj || {}));
}
function obterVersiculoEscala(tipo, chave) {
    var all = lerVersiculosEscala();
    var mapa = (all[tipo] || {});
    var k = String(chave || '').trim();
    var v = mapa[k];
    // tenta chave alternativa (nome vs id)
    if ((!v || !v.texto) && k) {
        Object.keys(mapa).forEach(function (mk) {
            if (mk.toLowerCase() === k.toLowerCase()) v = mapa[mk];
        });
    }
    if (v && v.texto) return { texto: v.texto, referencia: v.referencia || '' };
    return tipo === 'celula' ? Object.assign({}, VERSICULO_PADRAO_CELULA) : Object.assign({}, VERSICULO_PADRAO);
}
function salvarVersiculoEscala(tipo, chave, texto, referencia) {
    var all = lerVersiculosEscala();
    if (!all[tipo]) all[tipo] = {};
    var k = String(chave || '').trim();
    if (!k) return tipo === 'celula' ? Object.assign({}, VERSICULO_PADRAO_CELULA) : Object.assign({}, VERSICULO_PADRAO);
    var salvo = {
        texto: String(texto || '').trim() || (tipo === 'celula' ? VERSICULO_PADRAO_CELULA.texto : VERSICULO_PADRAO.texto),
        referencia: String(referencia || '').trim() || (tipo === 'celula' ? VERSICULO_PADRAO_CELULA.referencia : VERSICULO_PADRAO.referencia)
    };
    all[tipo][k] = salvo;
    salvarVersiculosEscala(all);
    // propaga para escalas já salvas dessa célula/ministério (atualiza PNG na próxima geração)
    try {
        if (tipo === 'celula' && typeof lerEscalaCelula === 'function' && typeof salvarEscalaCelula === 'function') {
            var linhas = lerEscalaCelula(k);
            var mudou = false;
            linhas.forEach(function (l, i) {
                linhas[i] = Object.assign({}, l, { versiculo: { texto: salvo.texto, referencia: salvo.referencia } });
                mudou = true;
            });
            if (mudou) salvarEscalaCelula(k, linhas);
        }
        if (tipo === 'ministerio' && typeof lerEscalaCultosMinisterio === 'function' && typeof salvarEscalaCultosMinisterio === 'function') {
            var linhasM = lerEscalaCultosMinisterio(k);
            linhasM.forEach(function (l, i) {
                linhasM[i] = Object.assign({}, l, { versiculo: { texto: salvo.texto, referencia: salvo.referencia } });
            });
            salvarEscalaCultosMinisterio(k, linhasM);
        }
    } catch (eProp) { console.warn('propagar versiculo', eProp); }
    return salvo;
}

/** Resolve versículo: formulário > linha salva > padrão da chave > NVI global */
function resolverVersiculoEscala(tipo, chave, linha, textoForm, refForm) {
    var tf = String(textoForm || '').trim();
    var rf = String(refForm || '').trim();
    if (tf) return { texto: tf, referencia: rf || (obterVersiculoEscala(tipo, chave).referencia || '') };
    if (linha && linha.versiculo && String(linha.versiculo.texto || '').trim()) {
        return { texto: String(linha.versiculo.texto).trim(), referencia: String(linha.versiculo.referencia || '').trim() };
    }
    return obterVersiculoEscala(tipo, chave);
}

/** Quebra texto em linhas para canvas */
function quebrarTextoCanvas(ctx, texto, maxW) {
    var palavras = String(texto || '').split(/\s+/);
    var linhas = [];
    var atual = '';
    palavras.forEach(function (p) {
        var t = atual ? atual + ' ' + p : p;
        if (ctx.measureText(t).width > maxW && atual) {
            linhas.push(atual);
            atual = p;
        } else {
            atual = t;
        }
    });
    if (atual) linhas.push(atual);
    return linhas;
}

/**
 * Cartaz estilo Atmosfera (creme, leve, versículo).
 * tipo: 'ministerio' | 'celula'
 * opts: { temaId, versiculo, referencia, aviso }
 */
function gerarCartazEscalaElegante(titulo, subtitulo, linha, tipo, opts) {
    if (!linha) return { sucesso: false, mensagem: 'Sem dados da escala.' };
    opts = opts || {};
    var W = 720;
    var navy = '#192D4B';
    var cream = '#faf6ef';
    var cream2 = '#f5f0e6';
    var rowEven = '#EBF0F8';
    var avisoBg = '#DCE6F5';

    var pares = [];
    if (tipo === 'celula' && typeof MODELO_ESCALA_CELULA !== 'undefined') {
        MODELO_ESCALA_CELULA.forEach(function (f) {
            var nomes = (linha.funcoes && linha.funcoes[f.nome]) ? linha.funcoes[f.nome] : [];
            if (!Array.isArray(nomes)) nomes = [nomes];
            nomes = nomes.filter(Boolean);
            pares.push({
                funcao: f.nome + ' (aprox. ' + f.minutos + ' min)',
                nomes: nomes.length ? nomes.join(', ') : '—'
            });
        });
    } else {
        Object.keys(linha.funcoes || {}).forEach(function (fn) {
            var nomes = linha.funcoes[fn];
            if (!Array.isArray(nomes)) nomes = [nomes];
            nomes = nomes.filter(Boolean);
            pares.push({ funcao: fn, nomes: nomes.length ? nomes.join(', ') : '—' });
        });
    }

    var versiculo = (opts.versiculo || (linha.versiculo && linha.versiculo.texto) || '').trim();
    var referencia = (opts.referencia || (linha.versiculo && linha.versiculo.referencia) || '').trim();
    if (!versiculo) {
        var pad = tipo === 'celula' ? VERSICULO_PADRAO_CELULA : VERSICULO_PADRAO;
        versiculo = pad.texto;
        referencia = pad.referencia;
    }

    // medir versículo
    var tmp = document.createElement('canvas').getContext('2d');
    tmp.font = 'italic 14px Georgia, serif';
    var linhasV = quebrarTextoCanvas(tmp, '“' + versiculo + '”', W - 120);

    var headerH = 100;
    var avisoH = tipo === 'celula' ? 42 : 40;
    var thH = 38;
    var rowH = 44;
    var versePad = 20;
    var verseLineH = 22;
    var verseH = versePad + linhasV.length * verseLineH + 8 + 22 + 12;
    var footerH = 28;
    var obsH = linha.observacao ? 40 : 0;
    var H = 20 + headerH + avisoH + thH + pares.length * rowH + obsH + verseH + footerH + 20;

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');

    // fundo página
    ctx.fillStyle = '#f0ebe3';
    ctx.fillRect(0, 0, W, H);

    // outer
    var m = 18;
    ctx.fillStyle = cream;
    ctx.fillRect(m, m, W - 2 * m, H - 2 * m);
    ctx.strokeStyle = navy + '88';
    ctx.lineWidth = 1;
    ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);

    // card
    var c = m + 12;
    var cW = W - 2 * c;
    ctx.fillStyle = cream;
    ctx.fillRect(c, c, cW, H - 2 * c);
    ctx.strokeStyle = navy;
    ctx.lineWidth = 3;
    ctx.strokeRect(c, c, cW, H - 2 * c);

    // cantos decorativos
    ctx.strokeStyle = navy + '55';
    ctx.lineWidth = 2;
    function canto(x, y, dx, dy) {
        ctx.beginPath();
        ctx.moveTo(x, y + dy * 22);
        ctx.lineTo(x, y);
        ctx.lineTo(x + dx * 22, y);
        ctx.stroke();
    }
    canto(c + 10, c + 10, 1, 1);
    canto(c + cW - 10, c + 10, -1, 1);
    canto(c + 10, H - c - 10, 1, -1);
    canto(c + cW - 10, H - c - 10, -1, -1);

    var y = c + 8;

    // header
    var grd = ctx.createLinearGradient(0, y, 0, y + headerH);
    grd.addColorStop(0, cream);
    grd.addColorStop(1, cream2);
    ctx.fillStyle = grd;
    ctx.fillRect(c + 4, y, cW - 8, headerH);

    ctx.fillStyle = navy;
    ctx.font = 'bold 26px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(titulo || 'ESCALA').toUpperCase(), W / 2, y + 40);
    ctx.font = '600 14px Segoe UI, Arial, sans-serif';
    ctx.fillText(String(subtitulo || ''), W / 2, y + 64);
    ctx.font = '600 13px Segoe UI, Arial, sans-serif';
    ctx.globalAlpha = 0.85;
    ctx.fillText(String(linha.dataLabel || linha.dataIso || ''), W / 2, y + 84);
    ctx.globalAlpha = 1;
    // linha decorativa
    ctx.strokeStyle = navy + '99';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 40, y + 94);
    ctx.lineTo(W / 2 + 40, y + 94);
    ctx.stroke();
    y += headerH;

    // aviso
    var avisoTxt = opts.aviso || (tipo === 'celula'
        ? 'Tempos aproximados · Oração ~2′ · Louvor ~8′ · Quebra Gelo ~10′ · Oferta ~5′ · Palavra ~30′ · Final ~5′'
        : '⚠  ESTAR NO PRÉDIO DA IGREJA 30 MINUTOS ANTES  ⚠');
    ctx.fillStyle = avisoBg;
    ctx.fillRect(c + 4, y, cW - 8, avisoH);
    ctx.strokeStyle = navy + '33';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(c + 4, y);
    ctx.lineTo(c + cW - 4, y);
    ctx.moveTo(c + 4, y + avisoH);
    ctx.lineTo(c + cW - 4, y + avisoH);
    ctx.stroke();
    ctx.fillStyle = navy;
    ctx.font = '600 11px Segoe UI, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(avisoTxt, W / 2, y + avisoH / 2 + 4);
    y += avisoH;

    // thead
    ctx.fillStyle = navy;
    ctx.fillRect(c + 4, y, cW - 8, thH);
    ctx.fillStyle = '#E6EBF5';
    ctx.font = '600 12px Segoe UI, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(tipo === 'celula' ? 'MOMENTO' : 'FUNÇÃO', c + 24, y + 24);
    ctx.fillText('RESPONSÁVEL', c + 260, y + 24);
    y += thH;

    pares.forEach(function (p, i) {
        ctx.fillStyle = i % 2 ? rowEven : cream;
        ctx.fillRect(c + 4, y, cW - 8, rowH);
        ctx.fillStyle = navy;
        ctx.font = '600 13px Segoe UI, Arial, sans-serif';
        ctx.textAlign = 'left';
        var fn = p.funcao;
        if (ctx.measureText(fn).width > 220) {
            while (fn.length > 3 && ctx.measureText(fn + '…').width > 220) fn = fn.slice(0, -1);
            fn += '…';
        }
        ctx.fillText(fn, c + 24, y + 28);
        ctx.fillStyle = '#3a3a3a';
        ctx.font = '400 13px Segoe UI, Arial, sans-serif';
        var nm = p.nomes;
        var maxN = cW - 280;
        if (ctx.measureText(nm).width > maxN) {
            while (nm.length > 3 && ctx.measureText(nm + '…').width > maxN) nm = nm.slice(0, -1);
            nm += '…';
        }
        ctx.fillText(nm, c + 260, y + 28);
        y += rowH;
    });

    if (linha.observacao) {
        ctx.fillStyle = '#D2DCEB';
        ctx.fillRect(c + 4, y, cW - 8, obsH);
        ctx.fillStyle = '#1E283C';
        ctx.font = '600 12px Segoe UI, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(linha.observacao), W / 2, y + 26);
        y += obsH;
    }

    // versículo
    ctx.fillStyle = cream;
    ctx.fillRect(c + 4, y, cW - 8, verseH);
    ctx.fillStyle = '#4a4a4a';
    ctx.font = 'italic 14px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    var vy = y + versePad + 14;
    linhasV.forEach(function (ln) {
        ctx.fillText(ln, W / 2, vy);
        vy += verseLineH;
    });
    ctx.fillStyle = navy;
    ctx.font = '600 12px Segoe UI, Arial, sans-serif';
    ctx.fillText(referencia, W / 2, vy + 6);
    y += verseH;

    // footer
    var fg = ctx.createLinearGradient(0, y, 0, y + footerH);
    fg.addColorStop(0, navy);
    fg.addColorStop(1, navy + 'cc');
    ctx.fillStyle = fg;
    ctx.fillRect(c + 4, y, cW - 8, footerH);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(c + 4, y, cW - 8, 3);
    ctx.fillStyle = '#E6EBF5';
    ctx.font = '11px Segoe UI, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('IBN Diamantino' + (tipo === 'celula' ? ' · Células' : ' · Ministérios') +
        (linha.status === 'rascunho' ? ' · Rascunho' : ''), W / 2, y + 18);

    try {
        var nomeArq = 'escala_' + String(subtitulo || titulo || 'dia').replace(/\s+/g, '_').toLowerCase() + '_' +
            String(linha.dataLabel || linha.dataIso || 'dia').replace(/[^\w\-]/g, '_') + '.png';
        canvas.toBlob(function (blob) {
            if (!blob) return;
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = nomeArq;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
                try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {}
            }, 800);
        }, 'image/png');
        return { sucesso: true, mensagem: 'PNG gerado: ' + nomeArq };
    } catch (e) {
        return { sucesso: false, mensagem: (e && e.message) || String(e) };
    }
}

function gerarCartazEscalaCelulaPng(nomeCelula, linha, temaId, textoForm, refForm) {
    var chave = (linha && linha.celulaId) || '';
    // se não tem id na linha, tenta achar pelo nome nas células conhecidas não é necessário — caller passa form
    var v = resolverVersiculoEscala('celula', chave || nomeCelula || '', linha, textoForm, refForm);
    return gerarCartazEscalaElegante(
        'Escala da Célula',
        nomeCelula || 'Célula',
        linha,
        'celula',
        { versiculo: v.texto, referencia: v.referencia, temaId: temaId }
    );
}

