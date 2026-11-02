// ==============================================
// Eventos + Inscritos via Supabase
// Substitui config/eventos_site e inscritos_eventos do Firestore
// ==============================================

const IBNEventosCloud = (function () {
    var client = null;
    var ultimoErro = null;

    function ativo() {
        return typeof EVENTOS_NO_SUPABASE !== 'undefined' && EVENTOS_NO_SUPABASE === true
            && typeof SUPABASE_URL === 'string' && SUPABASE_URL.indexOf('http') === 0
            && typeof SUPABASE_ANON_KEY === 'string' && SUPABASE_ANON_KEY.length > 10
            && typeof supabase !== 'undefined';
    }

    function getClient() {
        if (client) return client;
        if (!ativo()) {
            ultimoErro = 'Supabase não configurado ou lib não carregou';
            return null;
        }
        try {
            client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            ultimoErro = null;
            return client;
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            client = null;
            return null;
        }
    }

    function status() {
        return { ativo: ativo(), conectado: !!client, erro: ultimoErro };
    }

    /** Remove base64 de foto (não sobe blob gigante) */
    function eventoLeve(e) {
        if (!e) return null;
        var o = Object.assign({}, e);
        if (o.foto && String(o.foto).indexOf('data:') === 0) {
            o.fotoLocal = true;
            o.foto = '';
        }
        if (String(o.foto || '').length > 2000) o.foto = '';
        return o;
    }

    function eventoParaLinha(e) {
        e = eventoLeve(e);
        if (!e || !e.id) return null;
        return {
            id: String(e.id),
            nome: e.nome || '',
            data: e.data || (Array.isArray(e.datas) && e.datas[0]) || null,
            datas: e.datas || [],
            data_iso: e.dataIso || e.data_iso || e.data || null,
            horario: e.horario || '',
            horarios: e.horarios || [],
            valor: Number(e.valor) || 0,
            pix: e.pix || e.pixDestino || '',
            pix_destino: e.pixDestino || e.pix || '',
            forma: e.forma || e.formaPagamento || '',
            forma_pagamento: e.formaPagamento || e.forma || '',
            link_pagamento: e.linkPagamento || e.link_pagamento || '',
            foto: e.foto || '',
            foto_url: e.fotoUrl || e.foto_url || '',
            lideres: e.lideres || e.lideresEvento || [],
            formulario: e.formulario || [],
            atualizado_em: new Date().toISOString(),
            payload: e
        };
    }

    function linhaParaEvento(row) {
        if (!row) return null;
        var p = row.payload && typeof row.payload === 'object' ? row.payload : {};
        var ev = Object.assign({}, p, {
            id: row.id || p.id,
            nome: row.nome || p.nome || '',
            data: row.data || p.data || '',
            datas: row.datas || p.datas || [],
            dataIso: row.data_iso || p.dataIso || row.data || '',
            horario: row.horario || p.horario || '',
            horarios: row.horarios || p.horarios || [],
            valor: row.valor != null ? Number(row.valor) : (p.valor || 0),
            pix: row.pix || p.pix || '',
            pixDestino: row.pix_destino || p.pixDestino || row.pix || '',
            forma: row.forma || p.forma || '',
            formaPagamento: row.forma_pagamento || p.formaPagamento || row.forma || '',
            linkPagamento: row.link_pagamento || p.linkPagamento || '',
            foto: (row.foto_url || row.foto || p.foto || p.fotoUrl || ''),
            fotoUrl: row.foto_url || p.fotoUrl || '',
            lideres: row.lideres || p.lideres || [],
            formulario: row.formulario || p.formulario || []
        });
        // se só tinha foto local base64 no payload, não força de volta se veio vazio da nuvem
        if (ev.foto && String(ev.foto).indexOf('data:') === 0) {
            // ok no aparelho; na nuvem já limpamos
        }
        return ev;
    }

    async function salvarEventos(lista) {
        var sb = getClient();
        if (!sb) return { sucesso: false, mensagem: ultimoErro || 'Sem Supabase' };
        try {
            var linhas = (lista || []).map(eventoParaLinha).filter(Boolean);
            if (!linhas.length) {
                // lista vazia: não apaga tudo automaticamente (segurança)
                return { sucesso: true, quantidade: 0 };
            }
            var { error } = await sb.from('eventos').upsert(linhas, { onConflict: 'id' });
            if (error) {
                ultimoErro = error.message || String(error);
                console.error('salvarEventos Supabase:', error);
                return { sucesso: false, mensagem: ultimoErro };
            }
            console.log('Eventos salvos no Supabase:', linhas.length);
            return { sucesso: true, quantidade: linhas.length };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            console.error('salvarEventos:', e);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }

    async function puxarEventos() {
        var sb = getClient();
        if (!sb) return { sucesso: false, lista: [], mensagem: ultimoErro };
        try {
            var { data, error } = await sb.from('eventos').select('*').order('atualizado_em', { ascending: false });
            if (error) {
                ultimoErro = error.message || String(error);
                return { sucesso: false, lista: [], mensagem: ultimoErro };
            }
            var lista = (data || []).map(linhaParaEvento).filter(Boolean);
            return { sucesso: true, lista: lista, quantidade: lista.length };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, lista: [], mensagem: ultimoErro };
        }
    }

    async function removerEvento(id) {
        var sb = getClient();
        if (!sb || !id) return { sucesso: false, mensagem: ultimoErro };
        try {
            var { error } = await sb.from('eventos').delete().eq('id', String(id));
            if (error) return { sucesso: false, mensagem: error.message };
            return { sucesso: true };
        } catch (e) {
            return { sucesso: false, mensagem: (e && e.message) || String(e) };
        }
    }

    // ---------- INSCRITOS ----------

    function inscritoLeve(insc) {
        if (!insc) return null;
        var o = Object.assign({}, insc);
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

    function inscritoParaLinha(insc) {
        insc = inscritoLeve(insc);
        if (!insc) return null;
        var codigo = String(insc.codigo || insc.id || '');
        if (!codigo) return null;
        return {
            codigo: codigo,
            evento_id: insc.eventoId || insc.evento_id || '',
            evento_nome: insc.eventoNome || insc.evento_nome || '',
            nome: insc.nome || '',
            email: insc.email || '',
            telefone: insc.telefone || '',
            tipo: insc.tipo || '',
            valor: Number(insc.valor) || 0,
            pago: !!(insc.pago),
            status_pagamento: insc.statusPagamento || insc.status_pagamento || '',
            membro_id: insc.membroId || insc.membro_id || '',
            inscrito_por_nome: insc.inscritoPorNome || '',
            inscrito_por_email: insc.inscritoPorEmail || '',
            data_insc: insc.dataInsc || insc.data_insc || '',
            atualizado_em: insc.atualizadoEm || new Date().toISOString(),
            comprovante_enviado: !!(insc.comprovanteEnviado || insc.comprovante),
            comprovante_recebido: !!(insc.comprovanteRecebido),
            payload: insc
        };
    }

    function linhaParaInscrito(row) {
        if (!row) return null;
        var p = row.payload && typeof row.payload === 'object' ? row.payload : {};
        return Object.assign({}, p, {
            codigo: row.codigo || p.codigo,
            id: row.codigo || p.id || p.codigo,
            eventoId: row.evento_id || p.eventoId || '',
            eventoNome: row.evento_nome || p.eventoNome || '',
            nome: row.nome || p.nome || '',
            email: row.email || p.email || '',
            telefone: row.telefone || p.telefone || '',
            tipo: row.tipo || p.tipo || '',
            valor: row.valor != null ? Number(row.valor) : (p.valor || 0),
            pago: row.pago != null ? !!row.pago : !!p.pago,
            statusPagamento: row.status_pagamento || p.statusPagamento || '',
            membroId: row.membro_id || p.membroId || '',
            inscritoPorNome: row.inscrito_por_nome || p.inscritoPorNome || '',
            inscritoPorEmail: row.inscrito_por_email || p.inscritoPorEmail || '',
            dataInsc: row.data_insc || p.dataInsc || '',
            atualizadoEm: row.atualizado_em || p.atualizadoEm || '',
            comprovanteEnviado: !!(row.comprovante_enviado || p.comprovanteEnviado),
            comprovanteRecebido: !!(row.comprovante_recebido || p.comprovanteRecebido)
        });
    }

    async function salvarInscrito(insc) {
        var sb = getClient();
        if (!sb) return { sucesso: false, mensagem: ultimoErro || 'Sem Supabase' };
        try {
            var linha = inscritoParaLinha(insc);
            if (!linha) return { sucesso: false, mensagem: 'Inscrito sem código' };
            var { error } = await sb.from('inscritos_eventos').upsert(linha, { onConflict: 'codigo' });
            if (error) {
                ultimoErro = error.message || String(error);
                console.error('salvarInscrito Supabase:', error);
                return { sucesso: false, mensagem: ultimoErro };
            }
            return { sucesso: true, id: linha.codigo };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, mensagem: ultimoErro };
        }
    }

    async function salvarInscritosLista(lista) {
        var sb = getClient();
        if (!sb) return { sucesso: false, ok: 0, falha: 0, mensagem: ultimoErro };
        var ok = 0, falha = 0;
        var linhas = (lista || []).map(inscritoParaLinha).filter(Boolean);
        if (!linhas.length) return { sucesso: true, ok: 0, falha: 0 };
        // upsert em lotes de 50
        for (var i = 0; i < linhas.length; i += 50) {
            var lote = linhas.slice(i, i + 50);
            try {
                var { error } = await sb.from('inscritos_eventos').upsert(lote, { onConflict: 'codigo' });
                if (error) {
                    console.error('lote inscritos:', error);
                    falha += lote.length;
                } else {
                    ok += lote.length;
                }
            } catch (e) {
                console.error(e);
                falha += lote.length;
            }
        }
        return { sucesso: falha === 0, ok: ok, falha: falha };
    }

    async function puxarInscritos() {
        var sb = getClient();
        if (!sb) return { sucesso: false, lista: [], mensagem: ultimoErro };
        try {
            var { data, error } = await sb.from('inscritos_eventos').select('*').order('atualizado_em', { ascending: false });
            if (error) {
                ultimoErro = error.message || String(error);
                return { sucesso: false, lista: [], mensagem: ultimoErro };
            }
            var lista = (data || []).map(linhaParaInscrito).filter(Boolean);
            return { sucesso: true, lista: lista, quantidade: lista.length };
        } catch (e) {
            ultimoErro = (e && e.message) || String(e);
            return { sucesso: false, lista: [], mensagem: ultimoErro };
        }
    }

    async function removerInscrito(codigo) {
        var sb = getClient();
        if (!sb || !codigo) return { sucesso: false };
        try {
            var { error } = await sb.from('inscritos_eventos').delete().eq('codigo', String(codigo));
            if (error) return { sucesso: false, mensagem: error.message };
            return { sucesso: true };
        } catch (e) {
            return { sucesso: false, mensagem: (e && e.message) || String(e) };
        }
    }

    return {
        ativo: ativo,
        status: status,
        salvarEventos: salvarEventos,
        puxarEventos: puxarEventos,
        removerEvento: removerEvento,
        salvarInscrito: salvarInscrito,
        salvarInscritosLista: salvarInscritosLista,
        puxarInscritos: puxarInscritos,
        removerInscrito: removerInscrito
    };
})();
