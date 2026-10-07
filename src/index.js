import { __, sprintf } from '@wordpress/i18n';
import './index.css';

(function ($) {
  'use strict';

  const NS = '[OpenAlex]';
  const log = (...a) => { try { console.log(NS, ...a); } catch (e) {} };
  const err = (...a) => { try { console.error(NS, ...a); } catch (e) {} };

  const SEARCH_PLACEHOLDERS = {
    free: __('E.g. privacy by design, machine learning', 'tainacan-openalex'),
    title: __('E.g. Privacy by Design in Information Systems', 'tainacan-openalex'),
    author: __('E.g. Ann Cavoukian', 'tainacan-openalex'),
    doi: __('E.g. 10.1038/s41586-020-2649-2', 'tainacan-openalex'),
    issn: __('E.g. 0028-0846', 'tainacan-openalex')
  };

  const WORK_FIELDS = [
    { key: 'title', label: __('Title', 'tainacan-openalex') },
    { key: 'authors', label: __('Authors', 'tainacan-openalex') },
    { key: 'year', label: __('Year', 'tainacan-openalex') },
    { key: 'doi', label: __('DOI', 'tainacan-openalex') },
    { key: 'venue', label: __('Journal/Venue', 'tainacan-openalex') },
    { key: 'url', label: __('URL', 'tainacan-openalex') },
    { key: 'abnt', label: __('ABNT reference', 'tainacan-openalex') },
  ];

  const WORK_DETAIL_FIELDS = ['doi', 'venue', 'url', 'abnt'];

  let currentMapping = null;

  // =========================
  // Root do Form Hook
  // =========================
  function getRoot() {
    return document.getElementById('openalex-hook-root');
  }

  // O drawer de confirmação precisa viver diretamente no <body>.
  // Isso evita que transforms/stacking contexts do SPA do Tainacan prendam
  // o modal dentro da coluna do Form Hook e garante que ele fique acima
  // da admin bar e da barra fixa de ações do editor.
  function getConfirmationModalRoot() {
    let root = document.getElementById('openalex-modal-root');

    if (!root) {
      root = document.createElement('div');
      root.id = 'openalex-modal-root';
    }

    if (root.parentNode !== document.body) {
      document.body.appendChild(root);
    }

    return root;
  }

  function renderUIIfNeeded() {
    const root = getRoot();
    if (!root) return;

    if (root.__openalexMounted) return;
    root.__openalexMounted = true;

    root.innerHTML = `
      <div class="openalex-box">
        <div class="openalex-search-shell">
          <div class="field is-grouped is-grouped-multiline openalex-search-row">
            <div class="control">
              <span class="select">
                <select id="openalex-search-type" aria-label="${__('OpenAlex search type', 'tainacan-openalex')}">
                  <option value="free" selected>${__('Free search', 'tainacan-openalex')}</option>
                  <option value="title">${__('Title', 'tainacan-openalex')}</option>
                  <option value="author">${__('Author', 'tainacan-openalex')}</option>
                  <option value="doi">DOI</option>
                  <option value="issn">ISSN</option>
                </select>
              </span>
            </div>
            <div class="control is-expanded">
              <input
                type="text"
                class="input"
                id="openalex-query"
                placeholder="${SEARCH_PLACEHOLDERS.free}"
                autocomplete="off"
                aria-autocomplete="list"
                aria-controls="openalex-results"
                aria-expanded="false"
              />
            </div>
            <div class="control">
              <button type="button" class="button is-primary" id="openalex-search">${__('Search', 'tainacan-openalex')}</button>
            </div>
          </div>

          <div
            id="openalex-results-wrap"
            class="box openalex-results-wrap openalex-dropdown is-hidden"
            role="listbox"
            aria-label="${__('OpenAlex search results', 'tainacan-openalex')}"
          >
            <div id="openalex-results" class="openalex-results-list"></div>
          </div>
        </div>

        <div id="openalex-status" class="openalex-status"></div>
      </div>
    `;

    getConfirmationModalRoot();
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
    const $st = $('#openalex-status');
    if (!html) {
      $st.empty();
      return;
    }
    const allowedTones = ['is-primary', 'is-warning', 'is-danger', 'is-success'];
    const tone = allowedTones.includes(requestedTone)
      ? requestedTone
      : (isError ? 'is-danger' : 'is-primary');
    $st.html(`<div class="notification ${tone} is-light is-size-7 openalex-status-message openalex-resolved-info">${html}</div>`);
  }

  function clearWorkPreview() {
  $('#openalex-preview').empty();
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
      return { label: __('Not mapped', 'tainacan-openalex'), className: 'is-warning' };
    }

    if (empty) {
      return { label: __('Empty value', 'tainacan-openalex'), className: 'is-primary' };
    }

    return { label: __('Mapped', 'tainacan-openalex'), className: 'is-success' };
  }

  function getAppliedFieldStatus() {
    return { label: __('Filled', 'tainacan-openalex'), className: 'is-success' };
  }

  function getFailedFieldStatus() {
    return { label: __('Failed', 'tainacan-openalex'), className: 'is-danger' };
  }

  function getExistingTermFieldStatus(count) {
    return {
      label: count === 1 ? __('Existing term', 'tainacan-openalex') : __('Existing terms', 'tainacan-openalex'),
      className: 'is-success'
    };
  }

  function getCreatedTermFieldStatus(count) {
    return {
      label: count === 1 ? __('Created term', 'tainacan-openalex') : __('Created terms', 'tainacan-openalex'),
      className: 'is-success'
    };
  }

  function getPartialFieldStatus() {
    return { label: __('Partial', 'tainacan-openalex'), className: 'is-warning' };
  }

  function getNotFoundFieldStatus() {
    return { label: __('Not found', 'tainacan-openalex'), className: 'is-warning' };
  }

  function getForbiddenFieldStatus() {
    return { label: __('No permission', 'tainacan-openalex'), className: 'is-danger' };
  }

  function clearPreviewFieldMessages(fieldKey) {
    const $field = $('.openalex-confirm-modal .openalex-result-field[data-field="' + fieldKey + '"], .openalex-preview-card .openalex-result-field[data-field="' + fieldKey + '"]').first();
    $field.find('.openalex-field-resolution-messages').remove();
  }

  function appendPreviewFieldMessage(fieldKey, message, tone) {
    const $field = $('.openalex-confirm-modal .openalex-result-field[data-field="' + fieldKey + '"], .openalex-preview-card .openalex-result-field[data-field="' + fieldKey + '"]').first();

    if (!$field.length || !message) {
      return;
    }

    let $messages = $field.find('.openalex-field-resolution-messages');

    if (!$messages.length) {
      $messages = $('<div class="openalex-field-resolution-messages"></div>');
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
        warning && warning.message ? warning.message : __('Could not resolve one of the values.', 'tainacan-openalex'),
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
            ? sprintf(__('The term “%s” was created automatically.', 'tainacan-openalex'), names[0])
            : sprintf(__('%1$d terms were created automatically: %2$s.', 'tainacan-openalex'), createdTerms.length, names.join('; ')),
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
      ? 'content is-small openalex-field-value has-text-weight-semibold'
      : 'content is-small openalex-field-value';

    return `
      <div class="openalex-result-field" data-field="${escapeAttr(candidate.field)}">
        ${renderFieldLabelHtml(candidate.label || candidate.field, status)}
        <div class="${valueClass}">${escapeHtml(value || '—')}</div>
      </div>
    `;
  }

  function updatePreviewFieldStatus(fieldKey, status) {
    const $field = $('.openalex-confirm-modal .openalex-result-field[data-field="' + fieldKey + '"], .openalex-preview-card .openalex-result-field[data-field="' + fieldKey + '"]').first();

    if (!$field.length) {
      return;
    }

    const $tag = $field.find('.openalex-field-status');

    if (!$tag.length) {
      $field.find('.openalex-field-label').append(
        '<span class="tag is-light is-small ' + status.className + ' openalex-field-status">' + escapeHtml(status.label) + '</span>'
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
      ? `<span class="tag is-light is-small ${status.className} openalex-field-status">${escapeHtml(status.label)}</span>`
      : '';

    return `
      <p class="heading openalex-field-label">
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
        label: __('Title', 'tainacan-openalex'),
        metadatumId: map.title,
        value: normalizeText(work.title)
      },
      {
        field: 'authors',
        label: __('Authors', 'tainacan-openalex'),
        metadatumId: map.authors,
        value: authorsValues
      },
      {
        field: 'year',
        label: __('Year', 'tainacan-openalex'),
        metadatumId: map.year,
        value: normalizeText(work.year)
      },
      {
        field: 'doi',
        label: __('DOI', 'tainacan-openalex'),
        metadatumId: map.doi,
        value: normalizeText(work.doi)
      },
      {
        field: 'venue',
        label: __('Journal/Venue', 'tainacan-openalex'),
        metadatumId: map.venue,
        value: normalizeText(work.venue)
      },
      {
        field: 'url',
        label: __('URL', 'tainacan-openalex'),
        metadatumId: map.url,
        value: normalizeText(work.url)
      },
      {
        field: 'abnt',
        label: __('ABNT reference', 'tainacan-openalex'),
        metadatumId: map.abnt,
        value: normalizeText(work.abnt || '')
      }
    ];
  }

  function renderWorkPreview(candidates, appliedFields) {
    const $preview = $('#openalex-preview');

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
      <div class="openalex-results-wrap openalex-preview-wrap">
        <p class="has-text-weight-semibold openalex-results-title">${__('Imported values', 'tainacan-openalex')}</p>
        <div class="openalex-results-list">
          <div class="box openalex-item openalex-preview-card">
            <div class="openalex-result-summary">
              ${renderResultSummaryHtml(summaryWork)}
            </div>
            <div class="openalex-result-details">
              <div class="openalex-result-fields">
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
        ? 'content is-small openalex-field-value has-text-weight-semibold'
        : 'content is-small openalex-field-value';
      const status = map ? getFieldStatus(work, field.key, map) : null;

      return `
        <div class="openalex-result-field">
          ${renderFieldLabelHtml(field.label, status)}
          <div class="${valueClass}">${escapeHtml(value)}</div>
        </div>
      `;
    }).join('');
  }

  function renderResultSummaryHtml(work) {
    const title = getWorkFieldValue(work, 'title') || __('(untitled)', 'tainacan-openalex');
    const authors = getWorkFieldValue(work, 'authors');
    const year = getWorkFieldValue(work, 'year');
    const metaParts = [];

    if (authors) metaParts.push(escapeHtml(authors));
    if (year) metaParts.push(escapeHtml(year));

    return `
      <p class="has-text-weight-semibold openalex-result-title">${escapeHtml(title)}</p>
      ${metaParts.length ? `<p class="is-size-7 openalex-result-meta">${metaParts.join(' · ')}</p>` : ''}
    `;
  }

  function renderResultCard(work, map) {
    const title = getWorkFieldValue(work, 'title') || __('(untitled)', 'tainacan-openalex');
    const authors = getWorkFieldValue(work, 'authors');
    const year = getWorkFieldValue(work, 'year');
    const metaParts = [];

    if (authors) metaParts.push(escapeHtml(authors));
    if (year) metaParts.push(escapeHtml(year));

    return `
      <button
        type="button"
        class="openalex-suggestion"
        data-id="${escapeAttr(work.id)}"
        role="option"
        aria-label="${escapeAttr(sprintf(__('Select %s', 'tainacan-openalex'), title))}"
      >
        <span class="openalex-suggestion-copy">
          <span class="openalex-suggestion-title">${escapeHtml(title)}</span>
          ${metaParts.length ? `<span class="openalex-suggestion-meta">${metaParts.join(' · ')}</span>` : ''}
        </span>
        <span class="openalex-suggestion-action">${__('Select', 'tainacan-openalex')}</span>
      </button>
    `;
  }


  function getSearchType() {
    return ($('#openalex-search-type').val() || 'free').trim();
  }

  function syncPlaceholder() {
    const type = getSearchType();
    $('#openalex-query').attr('placeholder', SEARCH_PLACEHOLDERS[type] || SEARCH_PLACEHOLDERS.free);
  }

  function hideSearchResults() {
    $('#openalex-results').empty();
    $('#openalex-results-wrap').addClass('is-hidden');
    $('#openalex-query').attr('aria-expanded', 'false');
  }

  function renderResults(items, map) {
    const $container = $('#openalex-results');
    const $wrap = $('#openalex-results-wrap');

    $container.empty();

    if (!items || !items.length) {
      $container.append(
        '<div class="openalex-empty-result" role="option" aria-disabled="true">' + __('No results found.', 'tainacan-openalex') + '</div>'
      );
    } else {
      items.forEach((it) => {
        $container.append(renderResultCard(it, map));
      });
    }

    $wrap.removeClass('is-hidden');
    $('#openalex-query').attr('aria-expanded', 'true');
  }

  // =========================
  // AJAX
  // =========================
  function ajaxPost(action, data) {
    const ajaxUrl =
      (window.tainacanOpenAlex && window.tainacanOpenAlex.ajaxurl) ||
      (typeof ajaxurl !== 'undefined' ? ajaxurl : '');
    const nonce = (window.tainacanOpenAlex && window.tainacanOpenAlex.nonce) || '';
    return $.post(ajaxUrl, Object.assign({ action, nonce }, data || {}));
  }



  // =========================
  // Modal de confirmação
  // =========================
  function setModalStatus(html, isError, requestedTone) {
    const $status = $('#openalex-modal-status');

    if (!$status.length) return;
    if (!html) { $status.empty(); return; }

    const allowedTones = ['is-primary', 'is-warning', 'is-danger', 'is-success'];
    const tone = allowedTones.includes(requestedTone)
      ? requestedTone
      : (isError ? 'is-danger' : 'is-primary');

    $status.html(
      `<div class="notification ${tone} is-light is-size-7 openalex-modal-status-message">${html}</div>`
    );
  }

  function closeConfirmationModal(forceClose) {
    const root = getConfirmationModalRoot();
    if (!root) return;
    if (root.__openalexFilling && !forceClose) return;

    root.innerHTML = '';
    root.__openalexTasks = [];
    root.__openalexCandidates = [];
    root.__openalexFilling = false;

    if (!root.__openalexHadIsClipped) {
      document.documentElement.classList.remove('is-clipped');
    }

    root.__openalexHadIsClipped = false;
  }

  function openConfirmationLoading() {
    const root = getConfirmationModalRoot();
    if (!root) return;

    root.__openalexTasks = [];
    root.__openalexCandidates = [];
    root.__openalexFilling = false;
    root.__openalexHadIsClipped = document.documentElement.classList.contains('is-clipped');

    root.innerHTML = `
      <div class="openalex-confirm-modal">
        <div class="openalex-confirm-backdrop"></div>
        <aside class="openalex-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="openalex-modal-title">
          <header class="openalex-confirm-header">
            <div class="openalex-confirm-heading">
              <span class="openalex-confirm-kicker">OpenAlex</span>
              <h2 id="openalex-modal-title">${__('Confirm fill', 'tainacan-openalex')}</h2>
            </div>
            <button type="button" class="openalex-confirm-close openalex-modal-close" aria-label="${__('Close', 'tainacan-openalex')}">
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <section class="openalex-confirm-body">
            <div class="openalex-modal-loading">
              <button type="button" class="button is-loading" aria-hidden="true" tabindex="-1"></button>
              <span>${__('Loading reference details...', 'tainacan-openalex')}</span>
            </div>
          </section>
        </aside>
      </div>
    `;

    document.documentElement.classList.add('is-clipped');
  }

  function buildConfirmationTasks(candidates) {
    return (Array.isArray(candidates) ? candidates : [])
      .filter((candidate) => (
        !!parseInt(candidate.metadatumId, 10) &&
        !isRestValueEmpty(candidate.value)
      ))
      .map((candidate) => ({
        field: candidate.field,
        label: candidate.label,
        metadatumId: parseInt(candidate.metadatumId, 10),
        value: candidate.value
      }));
  }

  function renderConfirmationModal(candidates, work) {
    const root = getConfirmationModalRoot();
    if (!root) return;

    const tasks = buildConfirmationTasks(candidates);
    const fieldsHtml = (Array.isArray(candidates) ? candidates : [])
      .map((candidate) => renderPreviewFieldHtml(candidate, false))
      .join('');

    root.__openalexTasks = tasks;
    root.__openalexCandidates = candidates;
    root.__openalexFilling = false;

    root.innerHTML = `
      <div class="openalex-confirm-modal">
        <div class="openalex-confirm-backdrop openalex-modal-close"></div>
        <aside class="openalex-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="openalex-modal-title">
          <header class="openalex-confirm-header">
            <div class="openalex-confirm-heading">
              <span class="openalex-confirm-kicker">OpenAlex</span>
              <h2 id="openalex-modal-title">${__('Confirm fill', 'tainacan-openalex')}</h2>
            </div>
            <button type="button" class="openalex-confirm-close openalex-modal-close" aria-label="${__('Close', 'tainacan-openalex')}">
              <span aria-hidden="true">×</span>
            </button>
          </header>

          <section class="openalex-confirm-body">
            <div class="notification is-primary is-light is-size-7 openalex-confirm-note">
${__('Review the data before continuing. Confirming will fill the mapped metadata with OpenAlex values and may replace existing values in those fields.', 'tainacan-openalex')}
            </div>

            <div id="openalex-modal-status"></div>

            <div class="openalex-modal-work-summary">
              ${renderResultSummaryHtml(work || {})}
            </div>

            <div class="openalex-result-fields openalex-modal-fields">
              ${fieldsHtml}
            </div>
          </section>

          <footer class="openalex-confirm-footer openalex-modal-actions">
            <button type="button" class="button openalex-modal-close">${__('Cancel', 'tainacan-openalex')}</button>
            <button
              type="button"
              class="button is-primary openalex-confirm-fill"
              ${tasks.length ? '' : 'disabled'}
            >
              ${__('Fill metadata', 'tainacan-openalex')}
            </button>
          </footer>
        </aside>
      </div>
    `;

    document.documentElement.classList.add('is-clipped');

    if (!tasks.length) {
      setModalStatus(__('No mapped field has a value available to fill.', 'tainacan-openalex'), true, 'is-warning');
    }
  }

  function setConfirmationBusy(isBusy) {
    const root = getConfirmationModalRoot();
    if (root) root.__openalexFilling = !!isBusy;

    const $confirm = $('.openalex-confirm-fill');
    const $closeButtons = $('.openalex-confirm-modal .openalex-modal-close');

    $confirm.toggleClass('is-loading', !!isBusy).prop('disabled', !!isBusy);
    $closeButtons.prop('disabled', !!isBusy);
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
    const failure = response || new Error(__('Invalid response while resolving the metadatum.', 'tainacan-openalex'));
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
  console.group('[OpenAlex][DEBUG] fillQueue REST');

  log('[DEBUG] tasks recebidas:', tasks);

  const result = createEmptyQueueResult();
  const itemId = getCurrentTainacanItemId();

  log('[DEBUG] itemId detectado:', itemId);

  if (!itemId) {
    console.groupEnd();

    setStatus(
      __('Could not identify the current item in order to save metadata via the API.', 'tainacan-openalex'),
      true
    );

    result.failed = Array.isArray(tasks) ? tasks.length : 1;
    result.failedTasks.push({
      reason: 'item_id_not_found',
      message: __('Could not identify the current item.', 'tainacan-openalex')
    });
    return result;
  }

  if (!window.wp || !window.wp.apiFetch) {
    console.groupEnd();

    setStatus(
      __('The WordPress REST API is not available on this screen.', 'tainacan-openalex'),
      true
    );

    result.failed = Array.isArray(tasks) ? tasks.length : 1;
    result.failedTasks.push({
      reason: 'wp_api_fetch_unavailable',
      message: __('The WordPress REST API is not available.', 'tainacan-openalex')
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
      appendPreviewFieldMessage(field, __('The configured metadatum has an invalid ID.', 'tainacan-openalex'), 'is-danger');
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
        __('Could not resolve the values for this metadatum.', 'tainacan-openalex')
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
          __('No valid value could be resolved for this metadatum.', 'tainacan-openalex'),
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
        __('The values were resolved, but the metadatum could not be updated.', 'tainacan-openalex')
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
    parts.push(pluralizeQueueCount(result.applied, __('metadatum filled', 'tainacan-openalex'), __('metadata filled', 'tainacan-openalex')));
  }

  if (result.partial > 0) {
    parts.push(pluralizeQueueCount(result.partial, __('metadatum partially filled', 'tainacan-openalex'), __('metadata partially filled', 'tainacan-openalex')));
  }

  if (result.failed > 0) {
    parts.push(pluralizeQueueCount(result.failed, __('metadatum failed', 'tainacan-openalex'), __('metadata failed', 'tainacan-openalex')));
  }

  if (result.skipped > 0) {
    parts.push(pluralizeQueueCount(result.skipped, __('metadatum skipped', 'tainacan-openalex'), __('metadata skipped', 'tainacan-openalex')));
  }

  if (!parts.length) {
    return __('No metadata was processed.', 'tainacan-openalex');
  }

  const summary = parts.join(', ') + '.';
  const needsReview = result.partial > 0 || result.failed > 0 || result.warnings.length > 0;

  return needsReview
    ? summary + ' ' + __('Review the notices shown in the confirmation window.', 'tainacan-openalex')
    : summary + ' ' + __('Fill completed.', 'tainacan-openalex');
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

  async function fillWorkFromOpenAlex(openalexId, $trigger) {
    if (!openalexId) return;

    openConfirmationLoading();

    if ($trigger && $trigger.length) {
      $trigger.prop('disabled', true).attr('aria-busy', 'true');
    }

    try {
      let map = currentMapping;
      if (!map) map = await loadSettingsMapping();

      const resp = await ajaxPost('tainacan_openalex_work_get', { id: openalexId });
      if (!resp || !resp.success) {
        throw resp || new Error(__('Could not fetch details from OpenAlex.', 'tainacan-openalex'));
      }

      const work = (resp.data && resp.data.work) ? resp.data.work : {};
      const debug = (resp.data && resp.data.debug) ? resp.data.debug : null;
      const candidates = workToCandidates(work, map);

      log('[DEBUG] mapeamento recebido:', map);
      log('[DEBUG] work normalizado recebido:', work);
      log('[DEBUG] debug backend OpenAlex:', debug);

      console.table(candidates.map((candidate) => ({
        campo: candidate.field,
        rotulo: candidate.label,
        metadatumId: candidate.metadatumId,
        valor: Array.isArray(candidate.value) ? candidate.value.join(' | ') : candidate.value,
        mapeado: !!parseInt(candidate.metadatumId, 10),
        vazio: isRestValueEmpty(candidate.value)
      })));

      renderConfirmationModal(candidates, work);
    } catch (xhr) {
      const message = getAjaxErrorMessage(
        xhr,
        __('Could not load details for the selected reference.', 'tainacan-openalex')
      );

      closeConfirmationModal(true);
      setStatus(message, true, 'is-danger');
      err('[DEBUG] Erro ao preparar confirmação:', xhr);
    } finally {
      if ($trigger && $trigger.length) {
        $trigger.prop('disabled', false).removeAttr('aria-busy');
      }
    }
  }

  // =========================
  // UI events
  // =========================
  $(document).on('change', '#openalex-search-type', function () {
    syncPlaceholder();
    hideSearchResults();
  });

  $(document).on('click', '#openalex-search', function () {
    const $btn = $(this);
    const q = ($('#openalex-query').val() || '').trim();
    const searchType = getSearchType();

    if (!q) {
      hideSearchResults();
      setStatus(__('Enter something to search.', 'tainacan-openalex'), true);
      return;
    }

    hideSearchResults();
    setStatus(__('Searching OpenAlex...', 'tainacan-openalex'), false);
    $btn.addClass('is-loading').prop('disabled', true);

    const finishSearch = function () {
      $btn.removeClass('is-loading').prop('disabled', false);
    };

    ajaxPost('tainacan_openalex_work_search', { q, search_type: searchType })
      .done(function (resp) {
        if (!resp || !resp.success) {
          const msg = (resp && resp.data && resp.data.message) ? resp.data.message : __('Search failed.', 'tainacan-openalex');
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
            setStatus(__('Failed to load the mapping.', 'tainacan-openalex'), true);
            err('mapResp', mapResp);
            renderResults((resp.data && resp.data.results) || [], null);
          })
          .finally(finishSearch);
      })
      .fail(function (xhr) {
        const msg = xhr && xhr.responseJSON && xhr.responseJSON.data && xhr.responseJSON.data.message
          ? xhr.responseJSON.data.message
          : __('Search request failed.', 'tainacan-openalex');
        hideSearchResults();
        setStatus(msg, true);
        err('xhr', xhr);
        finishSearch();
      });
  });

  $(document).on('keydown', '#openalex-query', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#openalex-search').trigger('click');
      return;
    }

    if (e.key === 'Escape') hideSearchResults();
  });

  $(document).on('click', '.openalex-suggestion', function (e) {
    e.preventDefault();
    const $button = $(this);
    const openalexId = $button.data('id');

    hideSearchResults();
    fillWorkFromOpenAlex(openalexId, $button);
  });

  $(document).on('click', '.openalex-modal-close', function (e) {
    e.preventDefault();
    closeConfirmationModal(false);
  });

  $(document).on('click', '.openalex-confirm-fill', async function (e) {
    e.preventDefault();

    const root = getConfirmationModalRoot();
    const tasks = root && Array.isArray(root.__openalexTasks) ? root.__openalexTasks : [];

    if (!tasks.length) {
      setModalStatus(__('No mapped metadatum has a value available to fill.', 'tainacan-openalex'), true, 'is-warning');
      return;
    }

    setConfirmationBusy(true);
    setModalStatus(__('Filling metadata in Tainacan...', 'tainacan-openalex'), false, 'is-primary');

    let queueResult = createEmptyQueueResult();
    try {
      queueResult = await fillQueue(tasks);
    } finally {
      setConfirmationBusy(false);
    }

    const hasReviewableProblems =
      queueResult.partial > 0 ||
      queueResult.failed > 0 ||
      queueResult.warnings.length > 0;

    const successfulCount = queueResult.applied + queueResult.partial;
    const summary = buildQueueSummary(queueResult);

    if (successfulCount > 0 && !hasReviewableProblems) {
      closeConfirmationModal(true);
      setStatus(summary, false, 'is-success');
      return;
    }

    if (successfulCount > 0) {
      setModalStatus(summary, false, 'is-warning');
      setStatus(__('The import finished with warnings. Review the details in the confirmation window.', 'tainacan-openalex'), false, 'is-warning');
    } else {
      setModalStatus(summary, true, 'is-danger');
      setStatus(__('Could not fill the selected metadata.', 'tainacan-openalex'), true, 'is-danger');
    }
  });

  $(document).on('click', function (e) {
    const $target = $(e.target);
    if (
      !$target.closest('.openalex-search-shell').length &&
      !$target.closest('.openalex-confirm-modal').length
    ) {
      hideSearchResults();
    }
  });

  $(document).on('keydown', function (e) {
    if (e.key === 'Escape' && $('.openalex-confirm-modal').length) {
      closeConfirmationModal(false);
    }
  });

  setTimeout(syncPlaceholder, 50);

})(jQuery);
