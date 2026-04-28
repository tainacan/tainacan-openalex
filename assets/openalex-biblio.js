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
        <div class="openalex-biblio-help">A seleção do resultado e o preenchimento automático continuam funcionando como antes.</div>
        <div id="openalex-biblio-status" style="margin-top:.75rem;"></div>
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

  // =========================
  // Metadatum helpers
  // =========================
  function expandMetadatumIfCollapsed(metadatumId) {
    const id = parseInt(metadatumId, 10);
    if (!id) return false;

    const handle = document.querySelector(`[aria-controls="tainacan-item-metadatum_id-${id}"]`);
    if (!handle) return false;

    const expanded = handle.getAttribute('aria-expanded');
    if (expanded === 'false') {
      handle.click();
      return true;
    }
    return false;
  }

  function findBestProxyForTextMetadatum(host) {
    const nodes = [host, ...host.querySelectorAll('*')];
    const scored = [];

    for (const el of nodes) {
      const comp = el.__vueParentComponent || el.__vue__;
      const proxy = comp && (comp.proxy || comp);
      if (!proxy) continue;

      const hasHandler =
        (typeof proxy.changeValue === 'function') ||
        (typeof proxy.onInput === 'function') ||
        (proxy.itemMetadatum !== undefined);

      if (!hasHandler) continue;

      let score = 0;
      if (typeof proxy.changeValue === 'function') score += 10;
      if (typeof proxy.onInput === 'function') score += 7;
      if (typeof proxy.onBlur === 'function') score += 6;
      if (proxy.itemMetadatum) score += 7;

      scored.push({ proxy, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.length ? scored[0].proxy : null;
  }

  function ensureVueMounted(metadatumId, attempt = 0) {
    const id = parseInt(metadatumId, 10);
    if (!id) return Promise.resolve(false);

    expandMetadatumIfCollapsed(id);

    const host = document.querySelector('#tainacan-item-metadatum_id-' + id);
    if (host) {
      const proxy = findBestProxyForTextMetadatum(host);
      if (proxy) return Promise.resolve(true);
    }

    if (attempt >= 45) return Promise.resolve(false);
    return new Promise((resolve) =>
      setTimeout(() => resolve(ensureVueMounted(id, attempt + 1)), 120)
    );
  }

  function setAndCommitTextValue(metadatumId, rawValue) {
    const id = parseInt(metadatumId, 10);
    if (!id) return false;

    const host = document.querySelector('#tainacan-item-metadatum_id-' + id);
    if (!host) return false;

    const value = normalizeText(rawValue);
    const proxy = findBestProxyForTextMetadatum(host);

    if (proxy) {
      try { if (proxy.newValue !== undefined) proxy.newValue = value; } catch (e) {}
      try { if (proxy.internalValue !== undefined) proxy.internalValue = value; } catch (e) {}
      try { if (typeof proxy.onInput === 'function') proxy.onInput(value); } catch (e) {}

      try {
        if (typeof proxy.$emit === 'function') {
          proxy.$emit('update:modelValue', value);
          proxy.$emit('input', value);
        }
      } catch (e) {}
    }

    const inputEls = host.querySelectorAll('input:not([type="hidden"]), textarea');

    inputEls.forEach(inputEl => {
      try {
        inputEl.focus();

        const isTextarea = inputEl.tagName.toLowerCase() === 'textarea';
        const prototype = isTextarea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;

        if (nativeSetter) {
          nativeSetter.call(inputEl, value);
        } else {
          inputEl.value = value;
        }

        if (inputEl.__v_model) inputEl.__v_model.value = value;

        inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        inputEl.blur();
      } catch (e) {
        err('Erro ao injetar valor via DOM no campo', id, e);
      }
    });

    log('Commit Blindado OK:', id, value);
    return true;
  }

  async function fillQueue(tasks) {
    let applied = 0;

    for (const [mid, val] of tasks) {
      const okMount = await ensureVueMounted(mid);
      if (!okMount) {
        err('Não montou metadado (sem proxy Vue)', mid);
        continue;
      }

      await new Promise(r => setTimeout(r, 200));

      const ok = setAndCommitTextValue(mid, val);
      if (ok) applied++;

      await new Promise(r => setTimeout(r, 800));
    }

    return applied;
  }

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

            const tasks = [
              ...(map.title   ? [[map.title,   normalizeText(work.title)]] : []),
              ...(map.authors ? [[map.authors, normalizeText(work.authors)]] : []),
              ...(map.year    ? [[map.year,    normalizeText(work.year)]] : []),
              ...(map.doi     ? [[map.doi,     normalizeText(work.doi)]] : []),
              ...(map.venue   ? [[map.venue,   normalizeText(work.venue)]] : []),
              ...(map.url     ? [[map.url,     normalizeText(work.url)]] : []),
              ...(map.abnt    ? [[map.abnt,    normalizeText(work.abnt || '')]] : []),
            ].filter(([mid]) => !!parseInt(mid, 10));

            if (!tasks.length) {
              setStatus('Nenhum campo mapeado para preencher.', true);
              return;
            }

            setStatus('Preenchendo campos...', false);

            const applied = await fillQueue(tasks);

            $('#openalex-biblio-results').empty().hide();

            if (applied > 0) {
              setStatus('Preenchido! Agora clique em <strong>Salvar</strong>.', false);
            } else {
              setStatus('Não consegui aplicar valores nos campos. Veja o console (F12).', true);
            }
          })
          .fail(function (xhr) {
            setStatus('Erro ao obter detalhes (AJAX).', true);
            err('xhr', xhr);
          });
      })
      .fail(function (xhr) {
        setStatus('Erro ao carregar mapeamento (AJAX).', true);
        err('xhr', xhr);
      });
  });

  setTimeout(syncPlaceholder, 50);

})(jQuery);
