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

  const WORK_FIELDS = [
    { key: 'title', label: 'Título' },
    { key: 'authors', label: 'Autores' },
    { key: 'year', label: 'Ano' },
    { key: 'doi', label: 'DOI' },
    { key: 'venue', label: 'Periódico/Veículo' },
    { key: 'url', label: 'URL' },
    { key: 'abnt', label: 'Referência ABNT' },
  ];

  const WORK_DETAIL_FIELDS = ['doi', 'venue', 'url', 'abnt'];

  let currentMapping = null;

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
        <div class="field is-grouped is-grouped-multiline">
          <div class="control">
            <span class="select">
              <select id="openalex-biblio-search-type">
                <option value="free" selected>Busca livre</option>
                <option value="title">Título</option>
                <option value="author">Autor</option>
                <option value="doi">DOI</option>
                <option value="issn">ISSN</option>
              </select>
            </span>
          </div>
          <div class="control is-expanded">
            <input type="text" class="input" id="openalex-biblio-query" placeholder="${SEARCH_PLACEHOLDERS.free}" />
          </div>
          <div class="control">
            <button type="button" class="button is-primary" id="openalex-biblio-search">Buscar</button>
          </div>
        </div>
        <div id="openalex-biblio-status" class="openalex-biblio-status"></div>
        <div id="openalex-biblio-preview" class="openalex-biblio-preview"></div>
        <div id="openalex-biblio-results-wrap" class="openalex-biblio-results-wrap is-hidden">
          <p class="has-text-weight-semibold openalex-biblio-results-title">Resultados</p>
          <div id="openalex-biblio-results" class="openalex-biblio-results-list"></div>
        </div>
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
    if (!html) {
      $st.empty();
      return;
    }
    const tone = isError ? 'is-danger' : 'is-primary';
    $st.html(`<div class="notification ${tone} is-light is-size-7 openalex-biblio-status-message openalex-biblio-resolved-info">${html}</div>`);
  }

  function clearWorkPreview() {
  $('#openalex-biblio-preview').empty();
  }

function getCandidateDisplayValue(candidates, field) {
    const candidate = candidates.find((item) => item.field === field);
    if (!candidate) return '';

    if (Array.isArray(candidate.value)) {
      return candidate.value.join('; ');
    }

    return normalizeText(candidate.value);
  }

  function getCandidateStatus(candidate) {
    const mapped = !!parseInt(candidate.metadatumId, 10);
    const empty = isRestValueEmpty(candidate.value);

    if (!mapped) {
      return { label: 'Não mapeado', className: 'is-warning' };
    }

    if (empty) {
      return { label: 'Valor vazio', className: 'is-primary' };
    }

    return { label: 'Mapeado', className: 'is-success' };
  }

  function getAppliedFieldStatus() {
    return { label: 'Preenchido', className: 'is-success' };
  }

  function getFailedFieldStatus() {
    return { label: 'Falhou', className: 'is-danger' };
  }

  function renderPreviewFieldHtml(candidate, applied) {
    const value = Array.isArray(candidate.value)
      ? candidate.value.join(' | ')
      : normalizeText(candidate.value);
    const status = applied
      ? getAppliedFieldStatus()
      : getCandidateStatus(candidate);
    const valueClass = candidate.field === 'title'
      ? 'content is-small openalex-biblio-field-value has-text-weight-semibold'
      : 'content is-small openalex-biblio-field-value';

    return `
      <div class="openalex-biblio-result-field" data-field="${escapeAttr(candidate.field)}">
        ${renderFieldLabelHtml(candidate.label || candidate.field, status)}
        <div class="${valueClass}">${escapeHtml(value || '—')}</div>
      </div>
    `;
  }

  function updatePreviewFieldStatus(fieldKey, status) {
    const $field = $('.openalex-biblio-preview-card .openalex-biblio-result-field[data-field="' + fieldKey + '"]');

    if (!$field.length) {
      return;
    }

    const $tag = $field.find('.openalex-biblio-field-status');

    if (!$tag.length) {
      $field.find('.openalex-biblio-field-label').append(
        '<span class="tag is-light is-small ' + status.className + ' openalex-biblio-field-status">' + escapeHtml(status.label) + '</span>'
      );
      return;
    }

    $tag
      .removeClass('is-warning is-primary is-success is-danger')
      .addClass(status.className)
      .text(status.label);
  }

  function getFieldStatus(work, fieldKey, map) {
    if (!map) return null;

    let value = getWorkFieldValue(work, fieldKey);

    if (fieldKey === 'authors') {
      value = work.authors_list || value;
    }

    return getCandidateStatus({
      metadatumId: map[fieldKey],
      value,
    });
  }

  function renderFieldLabelHtml(label, status) {
    const statusTag = status
      ? `<span class="tag is-light is-small ${status.className} openalex-biblio-field-status">${escapeHtml(status.label)}</span>`
      : '';

    return `
      <p class="heading openalex-biblio-field-label">
        <strong><span>${escapeHtml(label)}</span></strong>
        ${statusTag}
      </p>
    `;
  }

  function workToCandidates(work, map) {
    const authorsValues = normalizeMultiValue(work.authors_list || work.authors);

    return [
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
  }

  function renderWorkPreview(candidates, appliedFields) {
    const $preview = $('#openalex-biblio-preview');

    if (!$preview.length) {
      return;
    }

    if (!Array.isArray(candidates) || !candidates.length) {
      $preview.empty();
      return;
    }

    const applied = appliedFields || {};
    const summaryWork = {
      title: getCandidateDisplayValue(candidates, 'title'),
      authors: getCandidateDisplayValue(candidates, 'authors'),
      year: getCandidateDisplayValue(candidates, 'year'),
    };
    const fieldsHtml = candidates.map((candidate) =>
      renderPreviewFieldHtml(candidate, !!applied[candidate.field])
    ).join('');

    $preview.html(`
      <div class="openalex-biblio-results-wrap openalex-biblio-preview-wrap">
        <p class="has-text-weight-semibold openalex-biblio-results-title">Valores importados</p>
        <div class="openalex-biblio-results-list">
          <div class="box openalex-biblio-item openalex-biblio-preview-card">
            <div class="openalex-biblio-result-summary">
              ${renderResultSummaryHtml(summaryWork)}
            </div>
            <div class="openalex-biblio-result-details">
              <div class="openalex-biblio-result-fields">
                ${fieldsHtml}
              </div>
            </div>
          </div>
        </div>
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

  function getWorkFieldValue(work, key) {
    if (key === 'authors') {
      if (Array.isArray(work.authors_list) && work.authors_list.length) {
        return work.authors_list.join('; ');
      }
      return normalizeText(work.authors);
    }
    return normalizeText(work[key]);
  }

  function renderWorkFieldsHtml(work, keys, map) {
    const fields = keys
      ? WORK_FIELDS.filter((field) => keys.includes(field.key))
      : WORK_FIELDS;

    return fields.map((field) => {
      const value = getWorkFieldValue(work, field.key) || '—';
      const valueClass = field.key === 'title'
        ? 'content is-small openalex-biblio-field-value has-text-weight-semibold'
        : 'content is-small openalex-biblio-field-value';
      const status = map ? getFieldStatus(work, field.key, map) : null;

      return `
        <div class="openalex-biblio-result-field">
          ${renderFieldLabelHtml(field.label, status)}
          <div class="${valueClass}">${escapeHtml(value)}</div>
        </div>
      `;
    }).join('');
  }

  function renderResultSummaryHtml(work) {
    const title = getWorkFieldValue(work, 'title') || '(sem título)';
    const authors = getWorkFieldValue(work, 'authors');
    const year = getWorkFieldValue(work, 'year');
    const metaParts = [];

    if (authors) metaParts.push(escapeHtml(authors));
    if (year) metaParts.push(escapeHtml(year));

    return `
      <p class="has-text-weight-semibold openalex-biblio-result-title">${escapeHtml(title)}</p>
      ${metaParts.length ? `<p class="is-size-7 openalex-biblio-result-meta">${metaParts.join(' · ')}</p>` : ''}
    `;
  }

  function renderResultCard(work, map) {
    const detailKeys = map
      ? WORK_FIELDS.map((field) => field.key)
      : WORK_DETAIL_FIELDS;

    return `
      <div class="box openalex-biblio-item" data-id="${escapeAttr(work.id)}">
        <div class="openalex-biblio-result-summary">
          ${renderResultSummaryHtml(work)}
        </div>
        <div class="openalex-biblio-result-details is-hidden">
          <div class="openalex-biblio-result-fields">
            ${renderWorkFieldsHtml(work, detailKeys, map)}
          </div>
        </div>
        <div class="field is-grouped is-grouped-right openalex-biblio-result-actions">
          <div class="control">
            <button type="button" class="button is-small openalex-biblio-toggle-details">Ver detalhes</button>
          </div>
          <div class="control">
            <button type="button" class="button is-small is-primary openalex-biblio-fill-btn">Preencher</button>
          </div>
        </div>
      </div>
    `;
  }



  function getSearchType() {
    return ($('#openalex-biblio-search-type').val() || 'free').trim();
  }

  function syncPlaceholder() {
    const type = getSearchType();
    $('#openalex-biblio-query').attr('placeholder', SEARCH_PLACEHOLDERS[type] || SEARCH_PLACEHOLDERS.free);
  }

  function renderResults(items, map) {
    const $container = $('#openalex-biblio-results');
    const $wrap = $('#openalex-biblio-results-wrap');
    $container.empty();
    $wrap.removeClass('is-hidden');

    if (!items || !items.length) {
      $container.append('<div class="box has-text-grey">Nenhum resultado.</div>');
      return;
    }

    items.forEach((it) => {
      $container.append(renderResultCard(it, map));
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

  const single = normalizeText(rawValue).trim();
  return single ? [single] : [];
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

      window.dispatchEvent(
        new CustomEvent('TainacanReloadItemMetadataForm', {
          detail: {
            itemId: itemId,
            metadatumId: metadatumId
          }
        })
      );

      updatePreviewFieldStatus(field, getAppliedFieldStatus());

      log('[DEBUG] evento disparado para metadado:', {
        itemId: itemId,
        metadatumId: metadatumId,
        field: field
      });

    } catch (e) {
      failed.push({
        field,
        metadatumId,
        values,
        error: e
      });

      updatePreviewFieldStatus(field, getFailedFieldStatus());

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

  console.groupEnd();

  return applied;
}

// fim issue 15

 

  async function loadSettingsMapping() {
    const mapResp = await ajaxPost('tainacan_openalex_get_settings_mapping', {});

    if (!mapResp || !mapResp.success) {
      throw mapResp;
    }

    currentMapping = (mapResp.data && mapResp.data.mapping) ? mapResp.data.mapping : {};
    return currentMapping;
  }

  async function fillWorkFromOpenAlex(openalexId, $fillBtn) {
    if (!openalexId) return;

    try {
      let map = currentMapping;

      if (!map) {
        setStatus('Carregando mapeamento...', false);
        map = await loadSettingsMapping();
      }

      setStatus('Carregando detalhes do OpenAlex...', false);

      const resp = await ajaxPost('tainacan_openalex_work_get', { id: openalexId });

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

      const candidates = workToCandidates(work, map);

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

      if ($fillBtn && $fillBtn.length) {
        $fillBtn.addClass('is-loading').prop('disabled', true);
      }

      let applied = 0;

      try {
        applied = await fillQueue(tasks);
      } finally {
        if ($fillBtn && $fillBtn.length) {
          $fillBtn.removeClass('is-loading').prop('disabled', false);
        }
      }

      $('#openalex-biblio-results').empty();
      $('#openalex-biblio-results-wrap').addClass('is-hidden');

      if (applied > 0) {
        setStatus(
          'Metadados enviados ao item. Lembre-se de revisar os valores.',
          false
        );
      } else {
        setStatus('Não foi possível enviar os dados para o item.', true);
      }
    } catch (xhr) {
      const data = xhr && xhr.responseJSON && xhr.responseJSON.data
        ? xhr.responseJSON.data
        : {};

      const message = data.message
        || (xhr && xhr.responseJSON && xhr.responseJSON.data && xhr.responseJSON.data.message)
        || 'Erro ao processar a seleção (AJAX).';

      setStatus(message, true);
      err('[DEBUG] Erro ao preencher work:', xhr);
    }
  }

  // =========================
  // UI events
  // =========================
  $(document).on('change', '#openalex-biblio-search-type', function () {
    syncPlaceholder();
  });

  $(document).on('click', '#openalex-biblio-search', function () {
    const $btn = $(this);
    const q = ($('#openalex-biblio-query').val() || '').trim();
    const searchType = getSearchType();

    if (!q) { setStatus('Digite algo para buscar.', true); return; }

    setStatus('Buscando no OpenAlex...', false);
    clearWorkPreview();
    $('#openalex-biblio-results').empty();
    $('#openalex-biblio-results-wrap').removeClass('is-hidden');

    $btn.addClass('is-loading').prop('disabled', true);

    const finishSearch = function () {
      $btn.removeClass('is-loading').prop('disabled', false);
    };

    ajaxPost('tainacan_openalex_work_search', { q, search_type: searchType })
      .done(function (resp) {
        if (!resp || !resp.success) {
          const msg = (resp && resp.data && resp.data.message) ? resp.data.message : 'Falha na busca.';
          setStatus(msg, true);
          err('resp', resp);
          finishSearch();
          return;
        }

        loadSettingsMapping()
          .then(function (map) {
            setStatus('', false);
            renderResults((resp.data && resp.data.results) || [], map);
          })
          .catch(function (mapResp) {
            setStatus('Falha ao carregar mapeamento.', true);
            err('mapResp', mapResp);
            renderResults((resp.data && resp.data.results) || [], null);
          })
          .finally(finishSearch);
      })
      .fail(function (xhr) {
        const msg = xhr && xhr.responseJSON && xhr.responseJSON.data && xhr.responseJSON.data.message
          ? xhr.responseJSON.data.message
          : 'Erro na busca (AJAX).';
        setStatus(msg, true);
        err('xhr', xhr);
        finishSearch();
      });
  });

  $(document).on('keydown', '#openalex-biblio-query', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#openalex-biblio-search').trigger('click');
    }
  });

  $(document).on('click', '.openalex-biblio-toggle-details', function (e) {
    e.preventDefault();

    const $btn = $(this);
    const $details = $btn.closest('.openalex-biblio-item').find('.openalex-biblio-result-details');
    const expanded = !$details.hasClass('is-hidden');

    if (expanded) {
      $details.addClass('is-hidden');
      $btn.text('Ver detalhes');
    } else {
      $details.removeClass('is-hidden');
      $btn.text('Ocultar detalhes');
    }
  });

  $(document).on('click', '.openalex-biblio-fill-btn', function (e) {
    e.preventDefault();

    const $btn = $(this);
    const openalexId = $btn.closest('.openalex-biblio-item').data('id');
    fillWorkFromOpenAlex(openalexId, $btn);
  });

  setTimeout(syncPlaceholder, 50);

})(jQuery);
