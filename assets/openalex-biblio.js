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
  function setStatus(html, isError, requestedTone) {
    const $st = $('#openalex-biblio-status');
    if (!html) {
      $st.empty();
      return;
    }
    const allowedTones = ['is-primary', 'is-warning', 'is-danger', 'is-success'];
    const tone = allowedTones.includes(requestedTone)
      ? requestedTone
      : (isError ? 'is-danger' : 'is-primary');
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

  function getExistingTermFieldStatus(count) {
    return {
      label: count === 1 ? 'Termo existente' : 'Termos existentes',
      className: 'is-success'
    };
  }

  function getCreatedTermFieldStatus(count) {
    return {
      label: count === 1 ? 'Termo criado' : 'Termos criados',
      className: 'is-success'
    };
  }

  function getPartialFieldStatus() {
    return { label: 'Parcial', className: 'is-warning' };
  }

  function getNotFoundFieldStatus() {
    return { label: 'Não encontrado', className: 'is-warning' };
  }

  function getForbiddenFieldStatus() {
    return { label: 'Sem permissão', className: 'is-danger' };
  }

  function clearPreviewFieldMessages(fieldKey) {
    const $field = $('.openalex-biblio-preview-card .openalex-biblio-result-field[data-field="' + fieldKey + '"]');
    $field.find('.openalex-biblio-field-resolution-messages').remove();
  }

  function appendPreviewFieldMessage(fieldKey, message, tone) {
    const $field = $('.openalex-biblio-preview-card .openalex-biblio-result-field[data-field="' + fieldKey + '"]');

    if (!$field.length || !message) {
      return;
    }

    let $messages = $field.find('.openalex-biblio-field-resolution-messages');

    if (!$messages.length) {
      $messages = $('<div class="openalex-biblio-field-resolution-messages"></div>');
      $field.append($messages);
    }

    const safeTone = ['is-warning', 'is-danger', 'is-success', 'is-primary'].includes(tone)
      ? tone
      : 'is-warning';

    $messages.append(
      '<div class="notification ' + safeTone + ' is-light is-size-7" style="margin-top:0.5rem;margin-bottom:0.25rem;padding:0.6rem 0.75rem;">' +
        escapeHtml(message) +
      '</div>'
    );
  }

  function getWarningStatus(warnings) {
    const codes = (warnings || []).map((warning) => warning && warning.code).filter(Boolean);

    if (codes.includes('term_creation_forbidden') || codes.includes('item_edit_forbidden')) {
      return getForbiddenFieldStatus();
    }

    if (
      codes.includes('term_not_found_closed_vocabulary') ||
      codes.includes('taxonomy_disallows_term_creation') ||
      codes.includes('ambiguous_term_name')
    ) {
      return getNotFoundFieldStatus();
    }

    return getFailedFieldStatus();
  }

  function renderResolutionWarnings(task, resolution) {
    const warnings = Array.isArray(resolution && resolution.warnings)
      ? resolution.warnings
      : [];

    clearPreviewFieldMessages(task.field);

    warnings.forEach((warning) => {
      appendPreviewFieldMessage(
        task.field,
        warning && warning.message ? warning.message : 'Não foi possível resolver um dos valores.',
        warning && warning.code === 'term_creation_forbidden' ? 'is-danger' : 'is-warning'
      );
    });

    if (resolution && resolution.is_taxonomy) {
      const terms = Array.isArray(resolution.terms) ? resolution.terms : [];
      const createdTerms = terms.filter((term) => term && term.created);

      if (createdTerms.length) {
        const names = createdTerms.map((term) => term.term_name || term.input_value).filter(Boolean);
        appendPreviewFieldMessage(
          task.field,
          createdTerms.length === 1
            ? 'O termo “' + names[0] + '” foi criado automaticamente.'
            : createdTerms.length + ' termos foram criados automaticamente: ' + names.join('; ') + '.',
          'is-success'
        );
      }
    }

    return warnings;
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

function getAjaxErrorData(error) {
  if (error && error.responseJSON && error.responseJSON.data) {
    return error.responseJSON.data;
  }

  if (error && error.data) {
    return error.data;
  }

  return {};
}

function getAjaxErrorMessage(error, fallbackMessage) {
  const responseData = getAjaxErrorData(error);

  if (responseData && responseData.message) {
    return responseData.message;
  }

  if (error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}

function getAjaxErrorStatus(error) {
  const responseData = getAjaxErrorData(error);
  const code = responseData && responseData.code ? responseData.code : '';

  if (code === 'forbidden' || code.endsWith('_forbidden')) {
    return getForbiddenFieldStatus();
  }

  return getFailedFieldStatus();
}

async function resolveMetadataValues(itemId, task) {
  const values = normalizeRestValue(task.value);

  const response = await ajaxPost(
    'tainacan_openalex_resolve_metadata_values',
    {
      item_id: itemId,
      metadatum_id: task.metadatumId,
      values: values
    }
  );

  if (!response || !response.success) {
    const failure = response || new Error('Resposta inválida ao resolver o metadado.');
    throw failure;
  }

  return response.data || {};
}

function getResolvedValues(resolution) {
  if (resolution && resolution.is_taxonomy) {
    return Array.from(new Set(
      (Array.isArray(resolution.term_ids) ? resolution.term_ids : [])
        .map((termId) => parseInt(termId, 10))
        .filter((termId) => termId > 0)
    ));
  }

  return normalizeRestValue(resolution && resolution.values ? resolution.values : []);
}

async function saveResolvedMetadata(itemId, task, resolvedValues, resolution = null) {
  let valuesForRest = resolvedValues;

  // Para metadado de Taxonomia não múltiplo, o endpoint REST do Tainacan
  // não deve receber [term_id]. O controller converte arrays em string via
  // implode(), e o repositório de termos passa a interpretar "16" como nome
  // de termo, criando um termo indevido chamado "16". Enviamos o ID como
  // inteiro escalar para preservar a resolução por term_id.
  if (
    resolution &&
    resolution.is_taxonomy &&
    !resolution.is_multiple &&
    Array.isArray(resolvedValues)
  ) {
    valuesForRest = resolvedValues.length > 0
      ? parseInt(resolvedValues[0], 10)
      : '';
  }

  const request = {
    path: `/tainacan/v2/item/${itemId}/metadata/${task.metadatumId}`,
    method: 'POST',
    data: {
      values: valuesForRest
    }
  };

  log('[DEBUG] POST REST metadado resolvido:', request);
  return window.wp.apiFetch(request);
}

function dispatchMetadataReload(itemId, metadatumId) {
  window.dispatchEvent(
    new CustomEvent('TainacanReloadItemMetadataForm', {
      detail: {
        itemId: itemId,
        metadatumId: metadatumId
      }
    })
  );
}

function getSuccessfulResolutionStatus(resolution) {
  if (!resolution || !resolution.is_taxonomy) {
    return getAppliedFieldStatus();
  }

  const terms = Array.isArray(resolution.terms) ? resolution.terms : [];
  const createdCount = terms.filter((term) => term && term.created).length;

  if (createdCount > 0) {
    return getCreatedTermFieldStatus(createdCount);
  }

  return getExistingTermFieldStatus(terms.length);
}

function createEmptyQueueResult() {
  return {
    applied: 0,
    partial: 0,
    failed: 0,
    skipped: 0,
    successfulTasks: [],
    partialTasks: [],
    failedTasks: [],
    skippedTasks: [],
    warnings: []
  };
}

async function fillQueue(tasks) {
  console.group('[OpenAlexBiblio][DEBUG] fillQueue REST');

  log('[DEBUG] tasks recebidas:', tasks);

  const result = createEmptyQueueResult();
  const itemId = getCurrentTainacanItemId();

  log('[DEBUG] itemId detectado:', itemId);

  if (!itemId) {
    console.groupEnd();

    setStatus(
      'Não foi possível identificar o item atual para salvar os metadados via API.',
      true
    );

    result.failed = Array.isArray(tasks) ? tasks.length : 1;
    result.failedTasks.push({
      reason: 'item_id_not_found',
      message: 'Não foi possível identificar o item atual.'
    });
    return result;
  }

  if (!window.wp || !window.wp.apiFetch) {
    console.groupEnd();

    setStatus(
      'A API REST do WordPress não está disponível nesta tela.',
      true
    );

    result.failed = Array.isArray(tasks) ? tasks.length : 1;
    result.failedTasks.push({
      reason: 'wp_api_fetch_unavailable',
      message: 'A API REST do WordPress não está disponível.'
    });
    return result;
  }

  console.table(tasks.map((task) => ({
    campo: task.field,
    metadatumId: task.metadatumId,
    valor: Array.isArray(task.value) ? task.value.join(' | ') : task.value
  })));

  for (const task of tasks) {
    const field = task.field || '(sem campo)';
    const metadatumId = parseInt(task.metadatumId, 10);
    const originalValues = normalizeRestValue(task.value);

    clearPreviewFieldMessages(field);

    log('[DEBUG] preparando metadado:', {
      field,
      metadatumId,
      originalValue: task.value,
      normalizedValues: originalValues
    });

    if (!metadatumId) {
      result.skipped++;
      result.skippedTasks.push({
        task,
        field,
        metadatumId,
        reason: 'metadatum_id_invalid'
      });

      updatePreviewFieldStatus(field, getFailedFieldStatus());
      appendPreviewFieldMessage(field, 'O metadado configurado possui um ID inválido.', 'is-danger');
      continue;
    }

    if (isRestValueEmpty(originalValues)) {
      result.skipped++;
      result.skippedTasks.push({
        task,
        field,
        metadatumId,
        reason: 'empty_value'
      });

      continue;
    }

    let resolution;

    try {
      resolution = await resolveMetadataValues(itemId, {
        ...task,
        metadatumId
      });
    } catch (resolutionError) {
      const message = getAjaxErrorMessage(
        resolutionError,
        'Não foi possível resolver os valores deste metadado.'
      );

      result.failed++;
      result.failedTasks.push({
        task,
        field,
        metadatumId,
        stage: 'resolution',
        error: resolutionError,
        message
      });

      updatePreviewFieldStatus(field, getAjaxErrorStatus(resolutionError));
      appendPreviewFieldMessage(field, message, 'is-danger');

      err('[DEBUG] erro na resolução do metadado:', {
        field,
        metadatumId,
        error: resolutionError
      });
      continue;
    }

    const warnings = renderResolutionWarnings(task, resolution);
    const resolvedValues = getResolvedValues(resolution);

    result.warnings.push(...warnings.map((warning) => ({
      field,
      metadatumId,
      ...warning
    })));

    log('[DEBUG] resolução concluída:', {
      field,
      metadatumId,
      resolution,
      resolvedValues
    });

    if (isRestValueEmpty(resolvedValues)) {
      result.failed++;
      result.failedTasks.push({
        task,
        field,
        metadatumId,
        stage: 'resolution',
        resolution,
        warnings,
        reason: 'no_resolved_values'
      });

      updatePreviewFieldStatus(field, getWarningStatus(warnings));

      if (!warnings.length) {
        appendPreviewFieldMessage(
          field,
          'Nenhum valor válido pôde ser resolvido para este metadado.',
          'is-danger'
        );
      }
      continue;
    }

    try {
      const response = await saveResolvedMetadata(
        itemId,
        {
          ...task,
          metadatumId
        },
        resolvedValues,
        resolution
      );

      dispatchMetadataReload(itemId, metadatumId);

      if (warnings.length > 0) {
        result.partial++;
        result.partialTasks.push({
          task,
          field,
          metadatumId,
          resolvedValues,
          resolution,
          warnings,
          response
        });
        updatePreviewFieldStatus(field, getPartialFieldStatus());
      } else {
        result.applied++;
        result.successfulTasks.push({
          task,
          field,
          metadatumId,
          resolvedValues,
          resolution,
          response
        });
        updatePreviewFieldStatus(field, getSuccessfulResolutionStatus(resolution));
      }

      log('[DEBUG] POST REST sucesso:', {
        field,
        metadatumId,
        resolvedValues,
        response
      });
    } catch (saveError) {
      const message = getAjaxErrorMessage(
        saveError,
        'Os valores foram resolvidos, mas o metadado não pôde ser atualizado.'
      );

      result.failed++;
      result.failedTasks.push({
        task,
        field,
        metadatumId,
        stage: 'save',
        resolvedValues,
        resolution,
        warnings,
        error: saveError,
        message
      });

      updatePreviewFieldStatus(field, getFailedFieldStatus());
      appendPreviewFieldMessage(field, message, 'is-danger');

      err('[DEBUG] POST REST erro:', {
        field,
        metadatumId,
        resolvedValues,
        error: saveError
      });
    }
  }

  log('[DEBUG] resumo REST:', {
    itemId,
    result
  });

  console.groupEnd();
  return result;
}

function pluralizeQueueCount(count, singular, plural) {
  return count + ' ' + (count === 1 ? singular : plural);
}

function buildQueueSummary(result) {
  const parts = [];

  if (result.applied > 0) {
    parts.push(pluralizeQueueCount(result.applied, 'metadado preenchido', 'metadados preenchidos'));
  }

  if (result.partial > 0) {
    parts.push(pluralizeQueueCount(result.partial, 'metadado parcialmente preenchido', 'metadados parcialmente preenchidos'));
  }

  if (result.failed > 0) {
    parts.push(pluralizeQueueCount(result.failed, 'metadado com falha', 'metadados com falha'));
  }

  if (result.skipped > 0) {
    parts.push(pluralizeQueueCount(result.skipped, 'metadado ignorado', 'metadados ignorados'));
  }

  if (!parts.length) {
    return 'Nenhum metadado foi processado.';
  }

  const summary = parts.join(', ') + '.';
  const needsReview = result.partial > 0 || result.failed > 0 || result.warnings.length > 0;

  return needsReview
    ? summary + ' Revise os avisos exibidos na prévia.'
    : summary + ' Revise os valores antes de salvar o item.';
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

      let queueResult = createEmptyQueueResult();

      try {
        queueResult = await fillQueue(tasks);
      } finally {
        if ($fillBtn && $fillBtn.length) {
          $fillBtn.removeClass('is-loading').prop('disabled', false);
        }
      }

      const hasReviewableProblems =
        queueResult.partial > 0 ||
        queueResult.failed > 0 ||
        queueResult.warnings.length > 0;

      if (!hasReviewableProblems) {
        $('#openalex-biblio-results').empty();
        $('#openalex-biblio-results-wrap').addClass('is-hidden');
      }

      const successfulCount = queueResult.applied + queueResult.partial;
      const summary = buildQueueSummary(queueResult);

      if (successfulCount > 0 && hasReviewableProblems) {
        setStatus(summary, false, 'is-warning');
      } else if (successfulCount > 0) {
        setStatus(summary, false, 'is-success');
      } else {
        setStatus(summary, true, 'is-danger');
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
