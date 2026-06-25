(function ($) {
  'use strict';

  const NS = '[OpenAlexBiblio]';
  const log = (...a) => { try { console.log(NS, ...a); } catch (e) {} };
  const err = (...a) => { try { console.error(NS, ...a); } catch (e) {} };

  const SEARCH_PLACEHOLDERS = {
    free: 'Ex.: privacy by design, machine learning, artigo sobre LGPD',
    title: 'Ex.: Privacy by Design in Information Systems',
    author: 'Ex.: Ann Cavoukian',
    doi: 'Ex.: 10.1038/s41586-020-2649-2',
    issn: 'Ex.: 0028-0836'
  };

  // =========================
  // Root do Form Hook
  // =========================
  function getRoot() {
    return document.getElementById('openalex-biblio-hook-root');
  }

  function renderUIIfNeeded() {
    const root = getRoot();
    if (!root) return;

    if (root.__openalexMounted) return;
    root.__openalexMounted = true;

    root.innerHTML = `
      <div class="openalex-biblio-box">
        <div class="openalex-biblio-row openalex-biblio-row-search">
          <select id="openalex-biblio-search-type">
            <option value="free" selected>Busca livre</option>
            <option value="title">Título</option>
            <option value="author">Autor</option>
            <option value="doi">DOI</option>
            <option value="issn">ISSN</option>
          </select>
          <input type="text" id="openalex-biblio-query" placeholder="${SEARCH_PLACEHOLDERS.free}" />
          <button type="button" class="button button-primary" id="openalex-biblio-search">Buscar</button>
        </div>
        <div class="openalex-biblio-help">A seleção do resultado salva os valores diretamente via API REST do Tainacan.</div>
        <div id="openalex-biblio-status" style="margin-top:.75rem;"></div>
        <div id="openalex-biblio-preview" class="openalex-biblio-preview" style="margin-top:.75rem;"></div>
        <ul id="openalex-biblio-results" class="openalex-biblio-results"></ul>
      </div>
    `;
    log('UI montada no Admin Form Hook');
  }

  const mo = new MutationObserver(() => {
    clearTimeout(renderUIIfNeeded.__t);
    renderUIIfNeeded.__t = setTimeout(renderUIIfNeeded, 120);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  renderUIIfNeeded();

  // =========================
  // Status / utils
  // =========================
  function setStatus(html, isError) {
    const $st = $('#openalex-biblio-status');
    $st.html(html || '');
    $st.css('color', isError ? '#b32d2e' : 'inherit');
  }

  function clearWorkPreview() {
  $('#openalex-biblio-preview').empty();
  }

function renderWorkPreview(candidates) {
  const $preview = $('#openalex-biblio-preview');

  if (!$preview.length) {
    return;
  }

  if (!Array.isArray(candidates) || !candidates.length) {
    $preview.empty();
    return;
  }

  const rows = candidates.map((candidate) => {
    const value = Array.isArray(candidate.value)
      ? candidate.value.join(' | ')
      : normalizeText(candidate.value);

    const mapped = !!parseInt(candidate.metadatumId, 10);
    const empty = isRestValueEmpty(candidate.value);

    let status = 'Será enviado';

    if (!mapped) {
      status = 'Não mapeado';
    } else if (empty) {
      status = 'Valor vazio';
    }

    return `
      <tr>
        <td><strong>${escapeHtml(candidate.label || candidate.field)}</strong></td>
        <td>${escapeHtml(value || '—')}</td>
        <td>${escapeHtml(status)}</td>
      </tr>
    `;
  }).join('');

  $preview.html(`
    <div class="openalex-biblio-preview-box">
      <strong>Valores retornados pelo OpenAlex</strong>

      <table class="widefat striped" style="margin-top:.5rem;">
        <thead>
          <tr>
            <th>Campo</th>
            <th>Valor</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `);
}


  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }
  function escapeAttr(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeText(v) {
    if (v == null) return '';
    return (typeof v === 'string') ? v : String(v);
  }

function normalizeMultiValue(v) {
  if (Array.isArray(v)) {
    return v
      .map(normalizeText)
      .map(s => s.trim())
      .filter(Boolean);
  }

  const single = normalizeText(v).trim();
  return single ? [single] : [];
}



  function getSearchType() {
    return ($('#openalex-biblio-search-type').val() || 'free').trim();
  }

  function syncPlaceholder() {
    const type = getSearchType();
    $('#openalex-biblio-query').attr('placeholder', SEARCH_PLACEHOLDERS[type] || SEARCH_PLACEHOLDERS.free);
  }

  function renderResolvedInfo(resolved) {
    if (!resolved || !resolved.type) return '';

    if (resolved.type === 'author') {
      const name = resolved.display_name ? escapeHtml(resolved.display_name) : 'autor';
      const worksCount = resolved.works_count != null ? ` • ${escapeHtml(resolved.works_count)} works` : '';
      return `<div class="openalex-biblio-meta">Autor selecionado pelo OpenAlex: <strong>${name}</strong>${worksCount}</div>`;
    }

    if (resolved.type === 'issn') {
      const name = resolved.display_name ? escapeHtml(resolved.display_name) : 'source';
      const issnL = resolved.issn_l ? ` • ISSN-L ${escapeHtml(resolved.issn_l)}` : '';
      return `<div class="openalex-biblio-meta">Source resolvida: <strong>${name}</strong>${issnL}</div>`;
    }

    if (resolved.type === 'doi') {
      return `<div class="openalex-biblio-meta">DOI resolvido diretamente no OpenAlex.</div>`;
    }

    if (resolved.type === 'title') {
      return `<div class="openalex-biblio-meta">Busca por título concluída.</div>`;
    }

    return `<div class="openalex-biblio-meta">Busca livre concluída.</div>`;
  }

  function renderResults(items, resolved) {
    const $ul = $('#openalex-biblio-results');
    $ul.empty();

    const resolvedHtml = renderResolvedInfo(resolved);
    if (resolvedHtml) {
      $ul.append(`<li class="openalex-biblio-info">${resolvedHtml}</li>`);
    }

    if (!items || !items.length) {
      $ul.append('<li class="openalex-biblio-empty">Nenhum resultado.</li>');
      return;
    }

    items.forEach((it) => {
      const title = it.title || '(sem título)';
      const year = it.year ? ` (${it.year})` : '';
      const doi = it.doi ? `<div class="openalex-biblio-doi">${escapeHtml(it.doi)}</div>` : '';

      $ul.append(`
        <li class="openalex-biblio-item" data-id="${escapeAttr(it.id)}">
          <div class="openalex-biblio-title">${escapeHtml(title)}${year}</div>
          ${doi}
        </li>
      `);
    });
  }

  // =========================
  // AJAX
  // =========================
  function ajaxPost(action, data) {
    const ajaxUrl =
      (window.tainacanOpenAlexBiblio && window.tainacanOpenAlexBiblio.ajaxurl) ||
      (typeof ajaxurl !== 'undefined' ? ajaxurl : '');
    const nonce = (window.tainacanOpenAlexBiblio && window.tainacanOpenAlexBiblio.nonce) || '';
    return $.post(ajaxUrl, Object.assign({ action, nonce }, data || {}));
  }



// issue 15
function parseTainacanItemIdFromString(source) {
  const text = decodeURIComponent(String(source || ''));

  const patterns = [
    /\/tainacan\/v2\/items\/(\d+)(?:[/?#]|$)/i,
    /\/tainacan\/v2\/item\/(\d+)(?:[/?#]|$)/i,

    /rest_route=\/tainacan\/v2\/items\/(\d+)(?:[&?#/]|$)/i,
    /rest_route=\/tainacan\/v2\/item\/(\d+)(?:[&?#/]|$)/i,

    /\/items\/(\d+)(?:[/?#]|$)/i,
    /\/item\/(\d+)(?:[/?#]|$)/i,

    /item_id[=/](\d+)/i,
    /[?&]item_id=(\d+)/i,
    /[?&]item=(\d+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match && match[1]) {
      const id = parseInt(match[1], 10);

      if (id > 0) {
        return id;
      }
    }
  }

  return 0;
}

function findTainacanItemEditionProxy() {
  const nodes = Array.from(document.querySelectorAll('*'));

  for (const node of nodes) {
    let comp = node.__vueParentComponent || node.__vue__ || null;

    while (comp) {
      const proxy = comp.proxy || comp;

      const looksLikeItemEditionForm =
        proxy &&
        proxy.itemId !== undefined &&
        (
          typeof proxy.loadItemMetadata === 'function' ||
          typeof proxy.handleExternalMetadataReloadEvent === 'function' ||
          Array.isArray(proxy.itemMetadata)
        );

      if (looksLikeItemEditionForm) {
        return proxy;
      }

      comp = comp.parent || null;
    }
  }

  return null;
}

function getCurrentTainacanItemIdFromVue() {
  const proxy = findTainacanItemEditionProxy();

  if (!proxy) {
    log('[DEBUG] Componente Vue de edição do item não encontrado.');
    return 0;
  }

  const itemId = parseInt(proxy.itemId, 10);

  if (itemId > 0) {
    log('[DEBUG] itemId encontrado no componente Vue do Tainacan:', itemId);
    return itemId;
  }

  log('[DEBUG] Componente Vue encontrado, mas itemId inválido:', proxy.itemId);

  return 0;
}

function getCurrentTainacanItemId() {
  const idFromVue = getCurrentTainacanItemIdFromVue();

  if (idFromVue) {
    return idFromVue;
  }

  const idFromUrl = parseTainacanItemIdFromString(window.location.href || '');

  if (idFromUrl) {
    log('[DEBUG] itemId encontrado pela URL:', idFromUrl);
    return idFromUrl;
  }

  const domCandidates = [
    'input[name="item_id"]',
    'input[name="itemId"]',
    'input[name="item[id]"]',
    '[data-item-id]',
    '[data-itemid]'
  ];

  for (const selector of domCandidates) {
    const el = document.querySelector(selector);

    if (!el) {
      continue;
    }

    const rawValue =
      el.value ||
      el.getAttribute('data-item-id') ||
      el.getAttribute('data-itemid') ||
      '';

    const idFromDom = parseInt(rawValue, 10);

    if (idFromDom > 0) {
      log('[DEBUG] itemId encontrado no DOM:', idFromDom, selector);
      return idFromDom;
    }
  }

  try {
    if (window.performance && typeof window.performance.getEntriesByType === 'function') {
      const entries = window.performance
        .getEntriesByType('resource')
        .slice()
        .reverse();

      for (const entry of entries) {
        const url = entry && entry.name ? entry.name : '';
        const decodedUrl = decodeURIComponent(url);

        if (!url || !/tainacan\/v2/i.test(decodedUrl)) {
          continue;
        }

        const idFromRequest = parseTainacanItemIdFromString(url);

        if (idFromRequest) {
          log('[DEBUG] itemId encontrado em chamada REST recente:', idFromRequest, url);
          return idFromRequest;
        }
      }
    }
  } catch (e) {
    err('[DEBUG] Erro ao tentar encontrar itemId em chamadas REST recentes:', e);
  }

  err('[DEBUG] Nenhum itemId foi encontrado.');
  return 0;
}

function normalizeRestValue(rawValue) {
  if (Array.isArray(rawValue)) {
    return normalizeMultiValue(rawValue);
  }

  return normalizeText(rawValue).trim();
}

function isRestValueEmpty(value) {
  return (
    value === '' ||
    value == null ||
    (Array.isArray(value) && value.length === 0)
  );
}

async function fillQueue(tasks) {
  console.group('[OpenAlexBiblio][DEBUG] fillQueue REST');

  log('[DEBUG] tasks recebidas:', tasks);

  const itemId = getCurrentTainacanItemId();

  log('[DEBUG] itemId detectado:', itemId);

  if (!itemId) {
    console.groupEnd();

    setStatus(
      'Não foi possível identificar o item atual para salvar os metadados via API.',
      true
    );

    return 0;
  }

  if (!window.wp || !window.wp.apiFetch) {
    console.groupEnd();

    setStatus(
      'A API REST do WordPress não está disponível nesta tela.',
      true
    );

    return 0;
  }

  let applied = 0;
  const successful = [];
  const skipped = [];
  const failed = [];

  console.table(tasks.map((task) => ({
    campo: task.field,
    metadatumId: task.metadatumId,
    valor: Array.isArray(task.value) ? task.value.join(' | ') : task.value
  })));

  for (const task of tasks) {
    const field = task.field || '(sem campo)';
    const metadatumId = parseInt(task.metadatumId, 10);
    const values = normalizeRestValue(task.value);

    log('[DEBUG] preparando metadado:', {
      field,
      metadatumId,
      originalValue: task.value,
      normalizedValues: values
    });

    if (!metadatumId) {
      skipped.push({
        field,
        metadatumId,
        reason: 'metadatumId inválido'
      });

      err('[DEBUG] metadatumId inválido. Campo ignorado:', {
        field,
        metadatumId,
        task
      });

      continue;
    }

    if (isRestValueEmpty(values)) {
      skipped.push({
        field,
        metadatumId,
        reason: 'valor vazio'
      });

      err('[DEBUG] valor vazio. Campo ignorado:', {
        field,
        metadatumId,
        values
      });

      continue;
    }

    const request = {
      path: `/tainacan/v2/item/${itemId}/metadata/${metadatumId}`,
      method: 'POST',
      data: {
        values: values
      }
    };

    try {
      log('[DEBUG] POST REST metadado:', request);

      const response = await window.wp.apiFetch(request);

      applied++;

      successful.push({
        field,
        metadatumId,
        values,
        response
      });

      log('[DEBUG] POST REST sucesso:', {
        field,
        metadatumId,
        values,
        response
      });

    } catch (e) {
      failed.push({
        field,
        metadatumId,
        values,
        error: e
      });

      err('[DEBUG] POST REST erro:', {
        field,
        metadatumId,
        values,
        error: e
      });
    }
  }

  log('[DEBUG] resumo REST:', {
    itemId,
    applied,
    successful,
    skipped,
    failed
  });

  if (successful.length === 1) {
    window.dispatchEvent(
      new CustomEvent('TainacanReloadItemMetadataForm', {
        detail: {
          itemId: itemId,
          metadatumId: successful[0].metadatumId
        }
      })
    );

    log('[DEBUG] evento disparado para um metadado:', {
      itemId: itemId,
      metadatumId: successful[0].metadatumId
    });

  } else if (successful.length > 1) {
    window.dispatchEvent(
      new CustomEvent('TainacanReloadItemMetadataForm')
    );

    log('[DEBUG] evento disparado uma vez para recarregar todo o formulário:', {
      itemId: itemId,
      metadatumIds: successful.map((item) => item.metadatumId)
    });
  }

  console.groupEnd();

  return applied;
}

// fim issue 15

 

  // =========================
  // UI events
  // =========================
  $(document).on('change', '#openalex-biblio-search-type', function () {
    syncPlaceholder();
  });

  $(document).on('click', '#openalex-biblio-search', function () {
    const q = ($('#openalex-biblio-query').val() || '').trim();
    const searchType = getSearchType();

    if (!q) { setStatus('Digite algo para buscar.', true); return; }

    setStatus('Buscando no OpenAlex...', false);
    clearWorkPreview();
    $('#openalex-biblio-results').empty().show();

    ajaxPost('tainacan_openalex_work_search', { q, search_type: searchType })
      .done(function (resp) {
        if (!resp || !resp.success) {
          const msg = (resp && resp.data && resp.data.message) ? resp.data.message : 'Falha na busca.';
          setStatus(msg, true);
          err('resp', resp);
          return;
        }
        setStatus('', false);
        renderResults((resp.data && resp.data.results) || [], (resp.data && resp.data.resolved) || null);
      })
      .fail(function (xhr) {
        const msg = xhr && xhr.responseJSON && xhr.responseJSON.data && xhr.responseJSON.data.message
          ? xhr.responseJSON.data.message
          : 'Erro na busca (AJAX).';
        setStatus(msg, true);
        err('xhr', xhr);
      });
  });

  $(document).on('keydown', '#openalex-biblio-query', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#openalex-biblio-search').trigger('click');
    }
  });

  $(document).on('click', '.openalex-biblio-item', function () {
    const openalexId = $(this).data('id');
    if (!openalexId) return;

    setStatus('Carregando mapeamento...', false);

    ajaxPost('tainacan_openalex_get_settings_mapping', {})
      .done(function (mapResp) {
        if (!mapResp || !mapResp.success) {
          setStatus('Falha ao carregar mapeamento.', true);
          err('mapResp', mapResp);
          return;
        }

        const map = (mapResp.data && mapResp.data.mapping) ? mapResp.data.mapping : {};

        setStatus('Carregando detalhes do OpenAlex...', false);

        ajaxPost('tainacan_openalex_work_get', { id: openalexId })
          .done(async function (resp) {
            if (!resp || !resp.success) {
              setStatus('Erro ao obter detalhes (AJAX).', true);
              err('resp', resp);
              return;
            }

            const work = (resp.data && resp.data.work) ? resp.data.work : {};
            const debug = (resp.data && resp.data.debug) ? resp.data.debug : null;

            log('[DEBUG] mapeamento recebido:', map);
            log('[DEBUG] work normalizado recebido:', work);
            log('[DEBUG] debug backend OpenAlex:', debug);

            const authorsValues = normalizeMultiValue(work.authors_list || work.authors);

            const candidates = [
              {
                field: 'title',
                label: 'Título',
                metadatumId: map.title,
                value: normalizeText(work.title)
              },
              {
                field: 'authors',
                label: 'Autores',
                metadatumId: map.authors,
                value: authorsValues
              },
              {
                field: 'year',
                label: 'Ano',
                metadatumId: map.year,
                value: normalizeText(work.year)
              },
              {
                field: 'doi',
                label: 'DOI',
                metadatumId: map.doi,
                value: normalizeText(work.doi)
              },
              {
                field: 'venue',
                label: 'Periódico/Veículo',
                metadatumId: map.venue,
                value: normalizeText(work.venue)
              },
              {
                field: 'url',
                label: 'URL',
                metadatumId: map.url,
                value: normalizeText(work.url)
              },
              {
                field: 'abnt',
                label: 'Referência ABNT',
                metadatumId: map.abnt,
                value: normalizeText(work.abnt || '')
              }
            ];

            renderWorkPreview(candidates);


            console.table(candidates.map((candidate) => ({
              campo: candidate.field,
              rotulo: candidate.label,
              metadatumId: candidate.metadatumId,
              valor: Array.isArray(candidate.value) ? candidate.value.join(' | ') : candidate.value,
              mapeado: !!parseInt(candidate.metadatumId, 10),
              vazio: isRestValueEmpty(candidate.value)
            })));

            const tasks = candidates
              .filter((candidate) => !!parseInt(candidate.metadatumId, 10))
              .map((candidate) => ({
                field: candidate.field,
                label: candidate.label,
                metadatumId: parseInt(candidate.metadatumId, 10),
                value: candidate.value
              }));

            log('[DEBUG] tasks finais para REST:', tasks);

            if (!tasks.length) {
              setStatus('Nenhum campo mapeado para preencher.', true);
              return;
            }

            setStatus('Enviando metadados ao Tainacan via API REST...', false);

            const applied = await fillQueue(tasks);

            $('#openalex-biblio-results').empty().hide();

            if (applied > 0) {
              setStatus(
                'Metadados enviados ao Tainacan. Aguarde o recarregamento dos campos, revise os valores e depois clique em <strong>Create item</strong>.',
                false
              );
            } else {
              setStatus('Não consegui enviar metadados ao Tainacan. Veja o console (F12).', true);
            }

          })
          .fail(function (xhr) {
            const data = xhr && xhr.responseJSON && xhr.responseJSON.data
              ? xhr.responseJSON.data
              : {};

            const message = data.message || 'Erro ao obter detalhes (AJAX).';

            setStatus(message, true);

            err('[DEBUG] Erro ao obter detalhes do work:', {
              httpStatus: xhr ? xhr.status : null,
              responseJSON: xhr ? xhr.responseJSON : null,
              responseText: xhr ? xhr.responseText : null,
              openalexUrl: data.openalex_url || null,
              idOriginal: data.id_original || null,
              openalexStatus: data.status || null,
              body: data.body || null
            });
          });
      })
      .fail(function (xhr) {
        setStatus('Erro ao carregar mapeamento (AJAX).', true);
        err('xhr', xhr);
      });
  });

  setTimeout(syncPlaceholder, 50);

})(jQuery);
