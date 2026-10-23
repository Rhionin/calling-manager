/* Local calling board. Do not add fetch, XHR, WebSocket, or beacons. Member data stays in the browser. */
(function ($) {
  var STORAGE_KEY = 'calling-manager.v1';
  var DB_NAME = 'calling-manager';
  var DB_STORE = 'state';
  var seq = 1;
  var usedOrgIds = {};
  var pipelineStatus = {};
  var currentActions = [];
  var readyToSave = false;
  var saveTimer = null;
  var armedMember = null;
  var picker = { mode: null, member: null, calling: null };
  var pickerRows = [];
  var pickerIndex = 0;
  var nameHandler = null;
  var confirmHandler = null;
  var pendingEncrypted = null;
  var listQuery = '';
  var dragScroll = { active: false, vy: 0, raf: 0 };
  var oldParent = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cleanLabel(value) {
    return String(value || '').replace(/[^\p{L}\p{M}\p{N} ,.'’()\/\-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function sanitizeHtml(html) {
    var doc = new DOMParser().parseFromString('<div id="cm-root">' + String(html || '') + '</div>', 'text/html');
    var root = doc.getElementById('cm-root');
    if (!root) return '';
    root.querySelectorAll('script, iframe, object, embed, link, meta, base').forEach(function (node) { node.remove(); });
    root.querySelectorAll('*').forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase();
        var val = attr.value || '';
        if (name.indexOf('on') === 0) el.removeAttribute(attr.name);
        if ((name === 'href' || name === 'src' || name === 'action') && /^\s*javascript:/i.test(val)) el.removeAttribute(attr.name);
      });
    });
    return root.innerHTML;
  }

  function measureToolbar() {
    var bar = document.querySelector('.top-section');
    if (!bar) return;
    document.documentElement.style.setProperty('--top-offset', bar.offsetHeight + 'px');
  }

  function openModal(sel) {
    $(sel).data('returnFocus', document.activeElement);
    $(sel).removeAttr('hidden');
    $('body').addClass('modal-open');
  }

  function closeModal(sel) {
    var $modal = $(sel);
    $modal.attr('hidden', 'hidden');
    if (sel === '#export-modal') {
      $('#export-text').val('');
      $('#export-pass, #export-pass2').val('');
    }
    if (sel === '#import-modal') {
      $('#import-passphrase').val('');
      pendingEncrypted = null;
    }
    if (!$('.cm-modal').not('[hidden]').length) $('body').removeClass('modal-open');
    var back = $modal.data('returnFocus');
    if (back && back.focus) {
      try { back.focus(); } catch (err) { /* ignore */ }
    }
  }

  function showMessage(title, message) {
    $('#message-title').text(title);
    $('#message-body').text(message);
    openModal('#message-modal');
  }

  function openConfirm(title, message, onYes) {
    $('#confirm-title').text(title);
    $('#confirm-message').text(message);
    confirmHandler = onYes;
    openModal('#confirm-modal');
    setTimeout(function () { $('#confirm-yes').trigger('focus'); }, 0);
  }

  function openNameModal(title, label, placeholder, onOk) {
    $('#name-modal-title').text(title);
    $('#name-modal-label').text(label);
    $('#name-modal-input').val('').attr('placeholder', placeholder);
    $('#name-modal-error').text('');
    nameHandler = onOk;
    openModal('#name-modal');
    setTimeout(function () { $('#name-modal-input').trigger('focus'); }, 0);
  }

  function formatSustained(activeDate) {
    if (activeDate == null || activeDate === '') return '';
    if (typeof moment !== 'function') return String(activeDate);
    var raw = String(activeDate);
    var parsed = moment(raw, ['YYYYMMDD', 'YYYY-MM-DD', moment.ISO_8601], true);
    if (!parsed.isValid() && typeof activeDate === 'number' && activeDate > 100000000000) parsed = moment(activeDate);
    if (!parsed.isValid()) return '';
    return parsed.format('YYYY MMM DD');
  }

  function servingBucket(activeDate) {
    if (typeof moment !== 'function' || activeDate == null || activeDate === '') return 0;
    var parsed = moment(String(activeDate), ['YYYYMMDD', 'YYYY-MM-DD', moment.ISO_8601], true);
    if (!parsed.isValid()) return 0;
    var months = moment().diff(parsed, 'months', true);
    var steps = [72, 66, 60, 54, 48, 42, 36, 30, 24, 18, 12, 6];
    for (var i = 0; i < steps.length; i++) if (months >= steps[i]) return steps[i];
    return 0;
  }

  function formatSetApart(value) {
    if (value === true || value === 'true' || value === 'Yes') return 'Yes';
    if (value === false || value === 'false' || value === 'No') return 'No';
    if (value == null || value === '') return '';
    if (typeof moment === 'function') {
      var parsed = moment(String(value), ['YYYYMMDD', 'YYYY-MM-DD', moment.ISO_8601], true);
      if (parsed.isValid()) return parsed.format('YYYY MMM DD');
    }
    return String(value);
  }

  function orgDomId(name) {
    var base = String(name || 'organization').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'organization';
    if (!usedOrgIds[base]) {
      usedOrgIds[base] = true;
      return base;
    }
    var n = 2;
    while (usedOrgIds[base + '-' + n]) n += 1;
    var id = base + '-' + n;
    usedOrgIds[id] = true;
    return id;
  }

  function memberMarkup(opts) {
    var id = opts.id || ('m' + (seq++));
    var classes = 'member' + (opts.serving ? ' in-calling-' + opts.serving : '') + (opts.userAdded ? ' user-added-member' : '');
    return '<ul class="' + classes + '" data-member-id="' + escapeHtml(id) + '" tabindex="0">' +
      '<i class="fa-solid fa-chevron-down" title="More info"></i>' +
      '<li class="name">' + escapeHtml(opts.name) + '</li>' +
      '<li class="current-calling">' + escapeHtml(opts.currentCalling || '') + '</li>' +
      '<li class="sustained">' + escapeHtml(opts.sustained || '') + '</li>' +
      '<li class="setapart">' + escapeHtml(opts.setApart || '') + '</li>' +
      '<div class="member-actions no-print">' +
      '<button type="button" class="assign-btn">Assign</button>' +
      '<button type="button" class="release-btn">Release</button>' +
      '</div></ul>';
  }

  function buildCalling(calling) {
    var occupied = !!calling.memberName;
    var id = 'c' + (seq++);
    var html = '<li class="calling ' + (occupied ? 'occupied' : 'not-occupied') + '" data-calling-id="' + id + '"';
    if (occupied) html += ' data-original-member="' + escapeHtml(calling.memberName) + '"';
    html += '><span class="calling-name">' + escapeHtml(calling.position) + '</span>';
    html += '<button type="button" class="place-here no-print" title="Choose a person for this calling">Place</button>';
    if (occupied) {
      html += memberMarkup({
        name: calling.memberName,
        currentCalling: calling.position,
        sustained: formatSustained(calling.activeDate),
        setApart: formatSetApart(calling.setApart),
        serving: servingBucket(calling.activeDate),
        userAdded: false
      });
    }
    html += '</li>';
    return html;
  }

  function renderOrg(org) {
    var html = '<ul id="' + orgDomId(org.defaultOrgName) + '" class="organization">';
    html += '<li class="h2 notSortable"><h2>' + escapeHtml(org.defaultOrgName) + '</h2><a href="#add-calling" title="Add calling"><i class="fa-regular fa-square-plus"></i></a></li>';
    (org.children || []).forEach(function (child) { html += renderOrg(child); });
    (org.callings || []).forEach(function (calling) { html += buildCalling(calling); });
    html += '</ul>';
    return html;
  }

  function renderBoard(orgs) {
    pipelineStatus = {};
    usedOrgIds = {};
    seq = 1;
    $('#ward > ul.organization').not('#hide').remove();
    $('#new > ul.member').remove();
    var html = '';
    orgs.forEach(function (org) { html += renderOrg(org); });
    if ($('#hide').length) $('#hide').before(html);
    else $('#ward').append(html);
  }

  function boardHasContent() {
    return $('#ward > ul.organization').not('#hide').length > 0 || $('#new > ul.member').length > 0 || $('#ward li.calling').length > 0;
  }

  function showBoard() {
    $('#form-page').addClass('aftersubmit');
    $('#menu-form').addClass('aftersubmit');
    $('#callings-page').removeClass('aftersubmit');
    $('#toolbar').removeAttr('hidden');
    $('#infobox, div.infobox').addClass('aftersubmit');
    if ($('#unit-banner').text()) $('#unit-banner').removeAttr('hidden');
    measureToolbar();
  }

  function showForm() {
    $('#form-page').removeClass('aftersubmit');
    $('#menu-form').removeClass('aftersubmit');
    $('#callings-page').addClass('aftersubmit').removeClass('view-hidden');
    $('#list-page').attr('hidden', 'hidden').removeClass('is-active');
    $('#toolbar').attr('hidden', 'hidden');
    $('#view-label').text('List');
    measureToolbar();
  }

  function showBoardView() {
    $('#callings-page').removeClass('view-hidden');
    $('#list-page').attr('hidden', 'hidden').removeClass('is-active');
    $('#toggle-view').attr('aria-pressed', 'false');
    $('#view-label').text('List');
  }

  function showListView() {
    $('#callings-page').addClass('view-hidden');
    $('#list-page').removeAttr('hidden').addClass('is-active');
    $('#toggle-view').attr('aria-pressed', 'true');
    $('#view-label').text('Board');
    renderList();
  }

  function bumpSeqFromDom() {
    $('[data-calling-id], [data-member-id]').each(function () {
      var raw = $(this).attr('data-calling-id') || $(this).attr('data-member-id') || '';
      var n = parseInt(String(raw).replace(/\D/g, ''), 10);
      if (n >= seq) seq = n + 1;
    });
  }

  function syncMemberButtons($member) {
    if (!$member || !$member.length) return;
    if (!$member.attr('data-member-id')) $member.attr('data-member-id', 'm' + (seq++));
    $member.attr('tabindex', '0');
    var $actions = $member.children('.member-actions');
    if (!$actions.length) {
      $member.append('<div class="member-actions no-print"><button type="button" class="assign-btn">Assign</button><button type="button" class="release-btn">Release</button></div>');
      $actions = $member.children('.member-actions');
    }
    var $rel = $actions.children('.release-btn');
    if ($member.parent().hasClass('calling')) {
      $rel.text('Release').attr('title', 'Move to unassigned').show();
    } else if ($member.hasClass('user-added-member')) {
      $rel.text('Remove').attr('title', 'Remove this name').show();
    } else {
      $rel.hide();
    }
  }

  function decorateCalling($calling) {
    if (!$calling.attr('data-calling-id')) $calling.attr('data-calling-id', 'c' + (seq++));
    if (!$calling.children('button.place-here').length) {
      $calling.children('span.calling-name').after('<button type="button" class="place-here no-print" title="Choose a person for this calling">Place</button>');
    }
    $calling.children('span.calling-name').attr('title', 'Choose a person for this calling');
    $calling.children('ul.member').each(function () { syncMemberButtons($(this)); });
  }

  function decorateUnassigned() {
    var $head = $('#new > li.h2');
    if (!$head.find('.unassigned-tools').length) {
      $head.append(
        '<div class="unassigned-tools no-print">' +
        '<button type="button" id="toggle-unassigned" aria-expanded="true">Collapse</button>' +
        '<label>Filter <input id="unassigned-filter" type="search" placeholder="Name" autocomplete="off"></label>' +
        '<span id="unassigned-count"></span></div>'
      );
    }
  }

  function decorateBoard() {
    if (!$('#sortparent').length) $('#callings-page').prepend('<ul id="sortparent" class="organization"></ul>');
    if (!$('#new').length) {
      $('#sortparent').after('<ul id="new" class="organization"><li class="h2 notSortable"><h2>Unassigned / names to consider</h2></li></ul>');
    }
    if (!$('#ward').length) $('#new').after('<ul id="ward"></ul>');
    if (!$('#hide').length) {
      $('#ward').append('<ul id="hide" class="organization"><li class="h2 notSortable"><h2>Hide</h2></li></ul>');
    }
    decorateUnassigned();
    bumpSeqFromDom();
    $('#ward li.calling').each(function () { decorateCalling($(this)); });
    $('#new > ul.member, #hide > ul.member').each(function () { syncMemberButtons($(this)); });
    updateUnassignedCount();
    updateCollapseButton();
  }

  function updateCollapseButton() {
    var collapsed = $('#new').hasClass('is-collapsed');
    $('#toggle-unassigned').attr('aria-expanded', collapsed ? 'false' : 'true').text(collapsed ? 'Expand' : 'Collapse');
  }

  function updateUnassignedCount() {
    var total = $('#new > ul.member').length;
    $('#unassigned-count').text(total === 1 ? '1 person' : total + ' people');
  }

  function addUnassignedPerson(name, userAdded) {
    $('#new').append(memberMarkup({
      name: name,
      currentCalling: '',
      sustained: '',
      setApart: '',
      userAdded: !!userAdded,
      serving: 0
    }));
  }

  function orgPath($calling) {
    var names = [];
    $calling.parents('ul.organization').each(function () {
      if (this.id === 'new' || this.id === 'hide' || this.id === 'ward') return;
      var name = $(this).children('li.h2').children('h2').first().text().trim();
      if (name) names.push(name);
    });
    return names.reverse().join(' — ');
  }

  function memberNames($calling) {
    return $calling.children('ul.member').map(function () {
      return $(this).children('li.name').first().text().trim();
    }).get();
  }

  function placeMember($member, $calling) {
    if (!$member || !$member.length || !$calling || !$calling.length) return;
    if (!document.body.contains($member[0])) return;
    var previous = $member.parent();
    $member.removeClass('deleted filter-hide');
    $calling.append($member);
    if ($calling.checkCallingChange) $calling.checkCallingChange();
    if (previous.length && previous[0] !== $calling[0] && previous.checkCallingChange) previous.checkCallingChange();
    syncMemberButtons($member);
    updateUnassignedCount();
    syncPipeline();
    saveSoon();
  }

  function releaseMember($member) {
    var parent = $member.parent();
    if (parent.hasClass('calling')) {
      $member.detach().removeClass('show');
      $('#new').append($member).removeClass('is-collapsed');
      parent.checkCallingChange();
      syncMemberButtons($member);
      updateCollapseButton();
      updateUnassignedCount();
      syncPipeline();
      saveSoon();
      return;
    }
    if ($member.hasClass('user-added-member')) {
      $member.remove();
      updateUnassignedCount();
      syncPipeline();
      saveSoon();
    }
  }

  function arm($member) {
    armedMember = $member;
    $('body').addClass('is-armed');
    $('#armed-name').text($member.children('li.name').first().text().trim());
    if ($('#assign-modal').is('[hidden]')) $('#armed-banner').removeAttr('hidden');
  }

  function disarm() {
    armedMember = null;
    $('body').removeClass('is-armed');
    $('#armed-banner').attr('hidden', 'hidden');
  }

  function renderPickerResults(query) {
    var q = String(query || '').trim().toLowerCase();
    pickerRows = [];
    if (picker.mode === 'callings') {
      $('#ward li.calling').each(function () {
        var $calling = $(this);
        var callingName = $calling.children('span.calling-name').first().text().trim();
        var org = orgPath($calling);
        var people = memberNames($calling);
        var hay = (callingName + ' ' + org + ' ' + people.join(' ')).toLowerCase();
        if (q && hay.indexOf(q) === -1) return;
        pickerRows.push({
          el: $calling,
          title: callingName,
          sub: (org || 'Calling') + (people.length ? ' — ' + people.join(', ') : ' — vacant'),
          sort: (people.length ? '1' : '0') + '\u0000' + org + '\u0000' + callingName
        });
      });
    } else {
      function pushPerson($member, group) {
        var name = $member.children('li.name').first().text().trim();
        var current = $member.parent().hasClass('calling') ? $member.parent().children('span.calling-name').text().trim() : '';
        var hay = (name + ' ' + current + ' ' + group).toLowerCase();
        if (q && hay.indexOf(q) === -1) return;
        pickerRows.push({
          el: $member,
          title: name,
          sub: group + (current ? ' — currently ' + current : ''),
          sort: (group === 'Unassigned' ? '0' : '1') + name
        });
      }
      $('#new > ul.member').each(function () { pushPerson($(this), 'Unassigned'); });
      $('#ward li.calling > ul.member, #hide > ul.member').each(function () { pushPerson($(this), 'On the board'); });
    }
    pickerRows.sort(function (a, b) {
      if (a.sort < b.sort) return -1;
      if (a.sort > b.sort) return 1;
      return 0;
    });
    var shown = pickerRows.slice(0, 80);
    var $list = $('#assign-results').empty();
    if (!shown.length) {
      $list.append('<li><p class="hint">Nothing matches that search.</p></li>');
      return;
    }
    shown.forEach(function (row, index) {
      var $button = $('<button type="button" role="option"></button>');
      $button.attr('data-index', index);
      $button.append($('<span class="opt-title"></span>').text(row.title));
      $button.append($('<span class="opt-sub"></span>').text(row.sub));
      $list.append($('<li></li>').append($button));
    });
    if (pickerRows.length > shown.length) {
      $list.append('<li><p class="hint">Showing the first 80 matches. Narrow the search.</p></li>');
    }
    pickerIndex = 0;
    highlightPicker();
  }

  function highlightPicker() {
    var $buttons = $('#assign-results button');
    $buttons.removeClass('is-active').attr('aria-selected', 'false');
    var $active = $buttons.eq(pickerIndex);
    $active.addClass('is-active').attr('aria-selected', 'true');
    if ($active[0] && $active[0].scrollIntoView) $active[0].scrollIntoView({ block: 'nearest' });
  }

  function openCallingPicker($member) {
    picker = { mode: 'callings', member: $member, calling: null };
    arm($member);
    $('#assign-title').text('Assign ' + $member.children('li.name').first().text().trim());
    $('#assign-hint').text('Search, then press Enter. Or close this and click a calling on the board.');
    $('#assign-search').val('');
    renderPickerResults('');
    openModal('#assign-modal');
    $('#armed-banner').attr('hidden', 'hidden');
    setTimeout(function () { $('#assign-search').trigger('focus'); }, 0);
  }

  function openPeoplePicker($calling) {
    picker = { mode: 'people', member: null, calling: $calling };
    $('#assign-title').text('Place someone as ' + $calling.children('span.calling-name').first().text().trim());
    $('#assign-hint').text('Unassigned people are listed first. Arrow keys move, Enter places.');
    $('#assign-search').val('');
    renderPickerResults('');
    openModal('#assign-modal');
    setTimeout(function () { $('#assign-search').trigger('focus'); }, 0);
  }

  function choosePicker(index) {
    var row = pickerRows[index];
    if (!row) return;
    if (picker.mode === 'callings' && picker.member) placeMember(picker.member, row.el);
    if (picker.mode === 'people' && picker.calling) placeMember(row.el, picker.calling);
    closeModal('#assign-modal');
    disarm();
  }

  function actionKey(type, memberName, callingName, orgName) {
    return [type, memberName, callingName, orgName].join('\u0001');
  }

  function collectActions() {
    var actions = [];
    $('#ward li.calling').each(function () {
      var $calling = $(this);
      var callingName = $calling.children('span.calling-name').first().text().trim();
      var orgName = orgPath($calling);
      var original = ($calling.attr('data-original-member') || '').trim();
      var names = memberNames($calling);
      if (original && names.indexOf(original) === -1) {
        actions.push({
          type: 'release',
          memberName: original,
          callingName: callingName,
          orgName: orgName,
          key: actionKey('release', original, callingName, orgName)
        });
      }
      $calling.children('ul.member').each(function () {
        var name = $(this).children('li.name').first().text().trim();
        var previous = $(this).children('li.current-calling').first().text().trim();
        if (!name || previous === callingName) return;
        actions.push({
          type: 'call',
          memberName: name,
          callingName: callingName,
          orgName: orgName,
          key: actionKey('call', name, callingName, orgName)
        });
      });
    });
    return actions;
  }

  function syncPipeline() {
    var live = {};
    currentActions = collectActions().map(function (action) {
      if (!pipelineStatus[action.key]) pipelineStatus[action.key] = 'proposed';
      action.status = pipelineStatus[action.key];
      live[action.key] = true;
      return action;
    });
    Object.keys(pipelineStatus).forEach(function (key) {
      if (!live[key]) delete pipelineStatus[key];
    });
    var openCount = currentActions.filter(window.CMPipeline.countsAsOpen).length;
    $('#pending-count').text(String(openCount));
    paintChips();
    if (!$('#pending-modal').is('[hidden]')) renderPending();
    if ($('#list-page').hasClass('is-active')) renderList();
  }

  function setStatus(key, status) {
    pipelineStatus[key] = status;
    syncPipeline();
    saveSoon();
  }

  function paintChips() {
    $('.pipeline-chip').remove();
    $('#ward li.calling').each(function () {
      var $calling = $(this);
      var callingName = $calling.children('span.calling-name').first().text().trim();
      var orgName = orgPath($calling);
      var labels = [];
      currentActions.forEach(function (action) {
        if (action.callingName === callingName && action.orgName === orgName && window.CMPipeline.countsAsOpen(action)) {
          var info = window.CMPipeline.statusInfo(action.type, action.status);
          labels.push((action.type === 'release' ? 'Release' : 'Call') + ': ' + info.label);
        }
      });
      if (labels.length) {
        $('<span class="pipeline-chip no-print"></span>').text(labels.join(' · ')).appendTo($calling);
      }
    });
  }

  function renderPending() {
    var checked = {};
    var hadPicks = $('#pending-body .pick').length > 0;
    $('#pending-body .pick').each(function () {
      checked[$(this).attr('data-key')] = $(this).prop('checked');
    });
    var $body = $('#pending-body').empty();
    $('#pending-note').text('');
    if (!currentActions.length) {
      $body.append('<p>No releases or new callings yet. Assign someone, or release them from a calling, and the next step shows up here.</p>');
      return;
    }
    ['release', 'call'].forEach(function (type) {
      var rows = currentActions.filter(function (action) { return action.type === type; });
      if (!rows.length) return;
      $body.append($('<h3></h3>').text(type === 'release' ? 'Releases' : 'New callings'));
      rows.forEach(function (action) {
        var index = currentActions.indexOf(action);
        var info = window.CMPipeline.statusInfo(action.type, action.status);
        var $row = $('<div class="pending-row"></div>');
        var $head = $('<header></header>');
        var $pick = $('<input type="checkbox" class="pick">').attr('data-index', index).attr('data-key', action.key);
        if (hadPicks && Object.prototype.hasOwnProperty.call(checked, action.key)) $pick.prop('checked', !!checked[action.key]);
        else if (window.CMPipeline.suggestForSacrament(action)) $pick.prop('checked', true);
        $head.append($('<label></label>').append($pick).append(document.createTextNode(' Include in wording')));
        $row.append($head);
        $row.append($('<p></p>').text(action.memberName + ' — ' + action.callingName + (action.orgName ? ' (' + action.orgName + ')' : '')));
        var $select = $('<select class="status-select"></select>').attr('data-index', index);
        window.CMPipeline.flow(action.type).forEach(function (status) {
          var $opt = $('<option></option>').attr('value', status.id).text(status.label);
          if (status.id === action.status) $opt.prop('selected', true);
          $select.append($opt);
        });
        $row.append($select);
        $row.append($('<p></p>').text('Next: ' + info.next));
        var $buttons = $('<div></div>');
        if (action.type === 'call' && action.status === 'extended') {
          $buttons.append($('<button type="button" class="advance-accept"></button>').attr('data-index', index).text('Accepted'));
          $buttons.append($('<button type="button" class="advance-decline"></button>').attr('data-index', index).text('Declined'));
        } else {
          var next = window.CMPipeline.nextStatus(action.type, action.status);
          if (next) {
            var nextInfo = window.CMPipeline.statusInfo(action.type, next);
            $buttons.append($('<button type="button" class="advance-next"></button>').attr('data-index', index).text('Mark ' + nextInfo.label));
          }
        }
        $row.append($buttons);
        $body.append($row);
      });
    });
  }

  function renderList() {
    var $body = $('#list-table tbody').empty();
    $('#ward li.calling').each(function () {
      var $calling = $(this);
      var callingName = $calling.children('span.calling-name').first().text().trim();
      var org = orgPath($calling);
      var callingId = $calling.attr('data-calling-id');
      var members = $calling.children('ul.member');
      if (!members.length) $body.append(listRow($calling, callingId, org, callingName, null));
      members.each(function () { $body.append(listRow($calling, callingId, org, callingName, $(this))); });
    });
    applyListFilter();
  }

  function listRow($calling, callingId, org, callingName, $member) {
    var name = $member ? $member.children('li.name').first().text().trim() : '';
    var sustained = $member ? $member.children('li.sustained').first().text().trim() : '';
    var setApart = $member ? $member.children('li.setapart').first().text().trim() : '';
    var previous = $member ? $member.children('li.current-calling').first().text().trim() : '';
    var changed = $calling.hasClass('changed') || $calling.hasClass('user-added-calling');
    var $row = $('<tr></tr>').toggleClass('changed', changed).toggleClass('vacant', !name);
    $row.attr('data-search', (org + ' ' + callingName + ' ' + name).toLowerCase());
    $row.append($('<td class="wrap"></td>').text(org));
    $row.append($('<td class="wrap"></td>').text(callingName));
    $row.append($('<td></td>').text(name || 'Vacant'));
    $row.append($('<td></td>').text(sustained));
    $row.append($('<td></td>').text(setApart));
    var action = null;
    currentActions.forEach(function (item) {
      if (item.callingName === callingName && item.orgName === org) {
        if (item.type === 'release' && !name) action = item;
        if (item.type === 'call' && item.memberName === name && previous !== callingName) action = item;
      }
    });
    if (action) {
      var info = window.CMPipeline.statusInfo(action.type, action.status);
      var index = currentActions.indexOf(action);
      var $select = $('<select class="status-select"></select>').attr('data-index', index);
      window.CMPipeline.flow(action.type).forEach(function (status) {
        var $opt = $('<option></option>').val(status.id).text(status.label);
        if (status.id === action.status) $opt.prop('selected', true);
        $select.append($opt);
      });
      $row.append($('<td></td>').append($select));
      $row.append($('<td class="wrap"></td>').text(info.next));
    } else {
      $row.append('<td></td><td></td>');
    }
    var $actions = $('<td></td>');
    $actions.append($('<button type="button" class="linkish show-calling"></button>').attr('data-calling-id', callingId).text('Show'));
    $actions.append($('<button type="button" class="linkish place-row"></button>').attr('data-calling-id', callingId).text('Place'));
    if ($member) {
      $actions.append($('<button type="button" class="linkish assign-row"></button>').attr('data-member-id', $member.attr('data-member-id')).text('Assign'));
    }
    $row.append($actions);
    return $row;
  }

  function applyListFilter() {
    var q = listQuery;
    $('#list-table tbody tr').each(function () {
      var hay = $(this).attr('data-search') || '';
      $(this).toggle(!q || hay.indexOf(q) !== -1);
    });
  }

  function scrollToEl($el) {
    if (!$el || !$el.length) return;
    showBoardView();
    var header = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--top-offset'), 10) || 100;
    var cover = header + Math.min($('#new').outerHeight() || 0, 180);
    var top = $el.offset().top - cover - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    $el.addClass('find-hit');
    setTimeout(function () { $el.removeClass('find-hit'); }, 1600);
  }

  function pointerY(event) {
    var original = event.originalEvent || event;
    if (original.touches && original.touches[0]) return original.touches[0].clientY;
    return event.clientY;
  }

  function onDragPointer(event) {
    if (!dragScroll.active) return;
    var y = pointerY(event);
    var margin = 80;
    var height = window.innerHeight;
    var max = 22;
    if (y < margin) dragScroll.vy = -Math.max(4, Math.ceil(((margin - y) / margin) * max));
    else if (y > height - margin) dragScroll.vy = Math.max(4, Math.ceil(((y - (height - margin)) / margin) * max));
    else dragScroll.vy = 0;
    if (dragScroll.vy && !dragScroll.raf) dragScroll.raf = window.requestAnimationFrame(tickDragScroll);
  }

  function tickDragScroll() {
    dragScroll.raf = 0;
    if (!dragScroll.active || !dragScroll.vy) return;
    window.scrollBy(0, dragScroll.vy);
    dragScroll.raf = window.requestAnimationFrame(tickDragScroll);
  }

  function startAutoScroll() {
    dragScroll.active = true;
    $(document).on('mousemove.cmscroll touchmove.cmscroll', onDragPointer);
  }

  function stopAutoScroll() {
    dragScroll.active = false;
    dragScroll.vy = 0;
    if (dragScroll.raf) window.cancelAnimationFrame(dragScroll.raf);
    dragScroll.raf = 0;
    $(document).off('.cmscroll');
  }

  function refreshSortable() {
    var $els = $('.calling, #new, #hide, #sortparent');
    $els.each(function () {
      if ($(this).data('ui-sortable')) $(this).sortable('destroy');
    });
    $els.sortable({
      items: '> ul.member',
      cancel: 'button, a, input, textarea, select, label, .notSortable, .member-actions',
      connectWith: '.calling, #new, #hide',
      cursor: 'move',
      tolerance: 'pointer',
      distance: 6,
      scroll: true,
      scrollSensitivity: 80,
      scrollSpeed: 20,
      zIndex: 4000,
      start: function (event, ui) {
        oldParent = ui.item.parent();
        ui.item.detach();
        $('#sortparent').append(ui.item);
        startAutoScroll();
        $('body').addClass('is-dragging');
      },
      stop: function (event, ui) {
        stopAutoScroll();
        $('body').removeClass('is-dragging');
        var $parent = ui.item.parent();
        if ($parent.length && $parent.checkCallingChange) $parent.checkCallingChange();
        if (oldParent && oldParent.length && oldParent[0] !== $parent[0] && oldParent.checkCallingChange) oldParent.checkCallingChange();
        syncMemberButtons(ui.item);
        updateUnassignedCount();
        syncPipeline();
        saveSoon();
      }
    });
    if ($('#toggle-touch').attr('aria-pressed') === 'true') $els.sortable('disable');
  }

  $.fn.checkCallingChange = function () {
    var parentCalling = $(this).children('span.calling-name').first().text();
    var childrenCallings = $(this).children('ul.member').find('li.current-calling').text();
    if ($(this).children('ul.member').hasClass('user-added-member') || $(this).find('ul.member').hasClass('user-added-member')) {
      $(this).addClass('changed');
    } else if ((childrenCallings === '') && $(this).hasClass('not-occupied')) {
      $(this).removeClass('changed');
    } else if (parentCalling === childrenCallings) {
      $(this).removeClass('changed');
    } else if (parentCalling !== childrenCallings) {
      $(this).addClass('changed');
    }
    return this;
  };

  function screenName() {
    if (!$('#form-page').hasClass('aftersubmit')) return 'form';
    return $('#list-page').hasClass('is-active') ? 'list' : 'board';
  }

  function collectState() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      screen: screenName(),
      changesDate: $('#dateOfChanges').text(),
      unitLabel: $('#unit-banner').text(),
      boardHtml: sanitizeHtml($('#callings-page').html()),
      pipeline: $.extend({}, pipelineStatus),
      unassignedCollapsed: $('#new').hasClass('is-collapsed')
    };
  }

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('no indexedDB'));
        return;
      }
      var request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function idbPut(state) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(state, 'current');
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function idbGet() {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readonly');
        var request = tx.objectStore(DB_STORE).get('current');
        request.onsuccess = function () { db.close(); resolve(request.result || null); };
        request.onerror = function () { db.close(); reject(request.error); };
      });
    });
  }

  function setSaveStatus(text) {
    $('#save-status').text(text);
  }

  function saveNow() {
    if (!readyToSave || !boardHasContent()) return;
    var state = collectState();
    var localOk = false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localOk = true;
    } catch (err) { /* quota or disabled */ }
    var time = typeof moment === 'function' ? moment(state.savedAt).format('h:mm A') : state.savedAt.slice(11, 16);
    idbPut(state).then(function () {
      setSaveStatus('Saved in this browser at ' + time);
    }).catch(function () {
      setSaveStatus(localOk ? 'Saved in this browser at ' + time : 'Could not save in this browser. Export a JSON file to keep this board.');
    });
  }

  function saveSoon() {
    if (!readyToSave) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveNow, 250);
  }

  function loadStoredState() {
    return idbGet().catch(function () { return null; }).then(function (fromDb) {
      var fromLocal = null;
      try { fromLocal = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (err) { fromLocal = null; }
      if (fromDb && fromLocal) return (fromLocal.savedAt || '') > (fromDb.savedAt || '') ? fromLocal : fromDb;
      return fromDb || fromLocal;
    });
  }

  function restoreState(state) {
    readyToSave = false;
    pipelineStatus = state.pipeline && typeof state.pipeline === 'object' ? state.pipeline : {};
    $('#callings-page').html(sanitizeHtml(state.boardHtml));
    if (state.changesDate) $('#dateOfChanges').text(state.changesDate);
    if (state.unitLabel) $('#unit-banner').text(state.unitLabel);
    if (state.unassignedCollapsed) $('#new').addClass('is-collapsed');
    showBoard();
    decorateBoard();
    refreshSortable();
    syncPipeline();
    if (state.screen === 'list') showListView();
    else if (state.screen === 'form') showForm();
    else showBoardView();
    readyToSave = true;
    measureToolbar();
  }

  function parseCallingsText(text, label, after) {
    $('#loading').show();
    window.setTimeout(function () {
      try {
        var data = JSON.parse(text);
        var orgs = window.CMParse.extractOrganizations(data);
        if (!orgs || !orgs.length) {
          showMessage(
            'Could not find callings',
            'The paste needs a JSON list of organizations with callings. The old LCR link has returned 404 since March 2026. Paste organization JSON, or load the fictional sample.'
          );
          return;
        }
        renderBoard(orgs);
        if (label) $('#unit-banner').text(label).removeAttr('hidden');
        $('#input-callings-by-org').val('');
        if (typeof moment === 'function') $('#dateOfChanges').text(moment().format('MMMM Do YYYY'));
        showBoard();
        if (after) after();
        if ($('#new > ul.member').length === 0) $('#new').addClass('is-collapsed');
        else $('#new').removeClass('is-collapsed');
        decorateBoard();
        refreshSortable();
        syncPipeline();
        saveSoon();
      } catch (err) {
        showMessage('Could not read that paste', 'The box needs JSON text, not a web page or an error message.');
      } finally {
        $('#loading').hide();
        measureToolbar();
      }
    }, 30);
  }

  function loadSample() {
    var run = function () {
      parseCallingsText(JSON.stringify(window.SAMPLE_WARD_CALLINGS), 'Sample Ward — fictional names, not real members', function () {
        (window.SAMPLE_NAMES_TO_CONSIDER || []).forEach(function (name) { addUnassignedPerson(name, true); });
      });
    };
    if (boardHasContent()) {
      openConfirm('Replace the current board with the sample?', 'The sample uses fictional names. Export first if you want a file copy of this board.', run);
      return;
    }
    run();
  }

  function beginParseFromForm() {
    var text = $('#input-callings-by-org').val();
    var run = function () { parseCallingsText(text, 'Pasted report — stored only in this browser'); };
    if (boardHasContent()) {
      openConfirm('Replace the current board?', 'Building from a new paste replaces the board in this browser. Export first if you want a file copy.', run);
      return;
    }
    run();
  }

  function downloadText(filename, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function copyText(text) {
    var buffer = document.getElementById('copy-buffer');
    buffer.value = text;
    buffer.removeAttribute('hidden');
    buffer.focus();
    buffer.select();
    var legacy = false;
    try { legacy = document.execCommand('copy'); } catch (err) { legacy = false; }
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacy; });
    }
    return Promise.resolve(legacy);
  }

  function buildExport() {
    var state = collectState();
    if ($('#export-encrypt').is(':checked')) {
      var first = $('#export-pass').val();
      var second = $('#export-pass2').val();
      if (first !== second) return Promise.reject(new Error('The passphrases do not match.'));
      return window.CMCrypto.encryptState(state, first);
    }
    return Promise.resolve({
      callingManagerExport: 1,
      encrypted: false,
      exportedAt: new Date().toISOString(),
      state: state
    });
  }

  function applyImportedState(state) {
    if (!state || typeof state !== 'object' || !state.boardHtml) {
      showMessage('That file is not a calling board', 'Choose a JSON file exported from this page.');
      return;
    }
    restoreState(state);
    saveNow();
    setSaveStatus('Imported into this browser');
  }

  function handleImportText(text) {
    var data;
    try { data = JSON.parse(text); } catch (err) {
      showMessage('Could not read that file', 'Choose a JSON export from this page.');
      return;
    }
    if (data && data.encrypted === true) {
      pendingEncrypted = data;
      $('#import-passphrase').val('');
      $('#import-error').text('');
      openModal('#import-modal');
      setTimeout(function () { $('#import-passphrase').trigger('focus'); }, 0);
      return;
    }
    var state = data && data.state && data.callingManagerExport ? data.state : data;
    applyImportedState(state);
  }

  function clearStored() {
    openConfirm('Clear the saved board?', 'This removes the board from this browser. Exported files stay where you saved them.', function () {
      readyToSave = false;
      try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }
      if (window.indexedDB) indexedDB.deleteDatabase(DB_NAME);
      pipelineStatus = {};
      currentActions = [];
      $('#ward > ul.organization').not('#hide').remove();
      $('#new > ul.member').remove();
      $('#unit-banner').text('').attr('hidden', 'hidden');
      $('#pending-count').text('0');
      showForm();
      disarm();
      readyToSave = true;
      setSaveStatus('Cleared from this browser');
    });
  }

  function bindEvents() {
    $('#callings-by-org-form').validate({
      submitHandler: function () {
        beginParseFromForm();
        return false;
      }
    });
    $('#callings-by-org-form').on('submit', function (event) { event.preventDefault(); });

    $(document).on('click', '#load-sample, .demo, .demo-button', function (event) {
      event.preventDefault();
      loadSample();
    });
    $('#fill-sample').on('click', function (event) {
      event.preventDefault();
      $('#input-callings-by-org').val(JSON.stringify(window.SAMPLE_WARD_CALLINGS, null, 2));
    });
    $(document).on('click', 'a.note, div.infobox .close', function (event) {
      event.preventDefault();
      $('div.infobox').toggleClass('open');
    });

    $('#add-member').on('click', function () {
      openNameModal('Add a person', 'Name', 'Last, First', function (name) {
        addUnassignedPerson(name, true);
        $('#new').removeClass('is-collapsed');
        decorateBoard();
        refreshSortable();
        updateCollapseButton();
        syncPipeline();
        saveSoon();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
    $(document).on('click', '.organization .fa-square-plus', function (event) {
      event.preventDefault();
      var $org = $(this).closest('ul.organization');
      openNameModal('Add a calling', 'Calling name', 'New calling', function (name) {
        $org.append('<li class="calling user-added-calling not-occupied"><span class="calling-name">' + escapeHtml(name) + '</span></li>');
        decorateCalling($org.children('li.calling').last());
        refreshSortable();
        syncPipeline();
        saveSoon();
      });
    });
    $('#name-form').on('submit', function (event) {
      event.preventDefault();
      var cleaned = cleanLabel($('#name-modal-input').val());
      if (!cleaned) {
        $('#name-modal-error').text('Enter a name using letters, numbers, and simple punctuation.');
        return;
      }
      var handler = nameHandler;
      nameHandler = null;
      closeModal('#name-modal');
      if (handler) handler(cleaned);
    });
    $('#confirm-yes').on('click', function () {
      var handler = confirmHandler;
      confirmHandler = null;
      closeModal('#confirm-modal');
      if (handler) handler();
    });

    $(document).on('click', '[data-close]', function () {
      var $modal = $(this).closest('.cm-modal');
      var disarmToo = $(this).is('[data-disarm]');
      closeModal('#' + $modal.attr('id'));
      if (disarmToo) disarm();
      else if ($modal.is('#assign-modal') && armedMember) $('#armed-banner').removeAttr('hidden');
    });
    $(document).on('keydown', function (event) {
      if (event.key === '/' && !$(event.target).is('input, textarea, select') && $('.cm-modal').not('[hidden]').length === 0 && !$('#toolbar').is('[hidden]')) {
        event.preventDefault();
        $('#board-search').trigger('focus');
        return;
      }
      if (event.key !== 'Escape') return;
      var $open = $('.cm-modal').not('[hidden]').last();
      if ($open.length) {
        var id = $open.attr('id');
        closeModal('#' + id);
        if (id === 'assign-modal' && armedMember) $('#armed-banner').removeAttr('hidden');
        return;
      }
      if (armedMember) disarm();
      $('#printMenu').slideUp();
    });
    $(document).on('keydown', '.cm-modal', function (event) {
      if (event.key !== 'Tab') return;
      var nodes = $(this).find('button, a, input, select, textarea').filter(':visible').get();
      if (!nodes.length) return;
      var first = nodes[0];
      var last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    $(document).on('click', '.assign-btn', function (event) {
      event.preventDefault();
      event.stopPropagation();
      openCallingPicker($(this).closest('ul.member'));
    });
    $(document).on('click', '.release-btn', function (event) {
      event.preventDefault();
      event.stopPropagation();
      releaseMember($(this).closest('ul.member'));
    });
    $(document).on('click', '.place-here', function (event) {
      event.preventDefault();
      event.stopPropagation();
      openPeoplePicker($(this).closest('li.calling'));
    });
    $(document).on('click', 'li.calling > span.calling-name', function (event) {
      var $calling = $(this).closest('li.calling');
      if (armedMember && armedMember.length && document.body.contains(armedMember[0])) {
        event.preventDefault();
        placeMember(armedMember, $calling);
        closeModal('#assign-modal');
        disarm();
        return;
      }
      openPeoplePicker($calling);
    });
    $(document).on('keydown', 'ul.member', function (event) {
      if (event.key !== 'Enter' || $(event.target).is('button, a, input, select')) return;
      event.preventDefault();
      openCallingPicker($(this));
    });
    $(document).on('click', '.member > i.fa-chevron-down', function (event) {
      event.preventDefault();
      $(this).parent().toggleClass('show');
    });
    $('#armed-cancel').on('click', disarm);
    $('#armed-search').on('click', function () {
      if (armedMember) openCallingPicker(armedMember);
    });

    $('#assign-search').on('input', function () { renderPickerResults($(this).val()); });
    $('#assign-search').on('keydown', function (event) {
      var $buttons = $('#assign-results button');
      if (!$buttons.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        pickerIndex = Math.min($buttons.length - 1, pickerIndex + 1);
        highlightPicker();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        pickerIndex = Math.max(0, pickerIndex - 1);
        highlightPicker();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        choosePicker(pickerIndex);
      }
    });
    $(document).on('click', '#assign-results button', function () {
      choosePicker(Number($(this).attr('data-index')));
    });

    $(document).on('click', '#toggle-unassigned', function () {
      $('#new').toggleClass('is-collapsed');
      updateCollapseButton();
      saveSoon();
    });
    $(document).on('input', '#unassigned-filter', function () {
      var q = $(this).val().trim().toLowerCase();
      $('#new > ul.member').each(function () {
        var name = $(this).children('li.name').first().text().toLowerCase();
        $(this).toggleClass('filter-hide', !!q && name.indexOf(q) === -1);
      });
    });

    $('#toggle-time').on('click', function () {
      $('#ward').toggleClass('time');
      $(this).attr('aria-pressed', $('#ward').hasClass('time') ? 'true' : 'false');
    });
    $('#toggle-touch').on('click', function () {
      var locked = $(this).attr('aria-pressed') === 'true';
      $('.calling, #new, #hide, #sortparent').sortable(locked ? 'enable' : 'disable');
      $(this).attr('aria-pressed', locked ? 'false' : 'true');
    });
    $('#toggle-view').on('click', function () {
      if ($('#list-page').hasClass('is-active')) showBoardView();
      else showListView();
      saveSoon();
    });
    $('#back-to-form').on('click', function () {
      showForm();
      saveSoon();
    });
    $('#clear-data').on('click', clearStored);

    $('#print-open').on('click', function (event) {
      event.preventDefault();
      $('#printMenu').slideToggle();
    });
    $('#printMenu').on('mouseleave', function () { $('#printMenu').slideUp(); });
    $('#print-changes').on('click', function (event) {
      event.preventDefault();
      $('#printChangesCSS').prop('disabled', false);
      $('#printAllCSS').prop('disabled', true);
      window.setTimeout(function () { window.print(); }, 150);
    });
    $('#print-all').on('click', function (event) {
      event.preventDefault();
      $('#printAllCSS').prop('disabled', false);
      $('#printChangesCSS').prop('disabled', true);
      window.setTimeout(function () { window.print(); }, 150);
    });

    $('#board-search').on('input', function () {
      var q = $(this).val().trim().toLowerCase();
      if (!q) {
        $('body').removeClass('is-finding');
        $('.calling').removeClass('find-hit find-miss');
        return;
      }
      $('body').addClass('is-finding');
      $('#ward li.calling').each(function () {
        var $calling = $(this);
        var hay = ($calling.children('span.calling-name').text() + ' ' + orgPath($calling) + ' ' + memberNames($calling).join(' ')).toLowerCase();
        var hit = hay.indexOf(q) !== -1;
        $calling.toggleClass('find-hit', hit).toggleClass('find-miss', !hit);
      });
    });
    $('#board-search').on('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        var $hit = $('#ward li.calling.find-hit').first();
        if ($hit.length) scrollToEl($hit);
      }
    });

    $('#open-pending').on('click', function () {
      syncPipeline();
      renderPending();
      openModal('#pending-modal');
    });
    $(document).on('change', '.status-select', function () {
      var action = currentActions[Number($(this).attr('data-index'))];
      if (action) setStatus(action.key, $(this).val());
    });
    $(document).on('click', '.advance-next', function () {
      var action = currentActions[Number($(this).attr('data-index'))];
      if (!action) return;
      var next = window.CMPipeline.nextStatus(action.type, action.status);
      if (next) setStatus(action.key, next);
    });
    $(document).on('click', '.advance-accept', function () {
      var action = currentActions[Number($(this).attr('data-index'))];
      if (action) setStatus(action.key, 'accepted');
    });
    $(document).on('click', '.advance-decline', function () {
      var action = currentActions[Number($(this).attr('data-index'))];
      if (action) setStatus(action.key, 'declined');
    });
    $('#generate-wording').on('click', function () {
      var selected = [];
      $('#pending-body .pick:checked').each(function () {
        var action = currentActions[Number($(this).attr('data-index'))];
        if (action) selected.push(action);
      });
      if (!selected.length) {
        $('#pending-note').text('Select at least one row.');
        return;
      }
      $('#wording-text').val(window.CMPipeline.buildProgram(selected));
      $('#copy-wording-note').text('');
      openModal('#wording-modal');
    });
    $('#copy-wording').on('click', function () {
      copyText($('#wording-text').val()).then(function (ok) {
        $('#copy-wording-note').text(ok ? 'Copied.' : 'Select the text and copy it.');
      });
    });

    $('#list-search').on('input', function () {
      listQuery = $(this).val().trim().toLowerCase();
      applyListFilter();
    });
    $(document).on('click', '.show-calling, .place-row', function () {
      var id = $(this).attr('data-calling-id');
      var $calling = $('#ward li.calling').filter(function () {
        return $(this).attr('data-calling-id') === id;
      });
      if ($(this).hasClass('show-calling')) scrollToEl($calling);
      else openPeoplePicker($calling);
    });
    $(document).on('click', '.assign-row', function () {
      var id = $(this).attr('data-member-id');
      var $member = $('ul.member').filter(function () {
        return $(this).attr('data-member-id') === id;
      });
      if ($member.length) openCallingPicker($member.first());
    });

    $('#open-export').on('click', function () {
      if (!boardHasContent()) {
        showMessage('Nothing to export', 'Build a board first.');
        return;
      }
      $('#export-encrypt').prop('checked', false);
      $('#export-pass, #export-pass2, #export-text').val('');
      $('#export-crypto-fields').attr('hidden', 'hidden');
      $('#export-error').text('');
      if (!window.CMCrypto.canEncrypt()) {
        $('#export-encrypt').prop('disabled', true);
        $('#export-crypto-note').text('Encryption needs https or localhost. A plain JSON download still works.');
      } else {
        $('#export-encrypt').prop('disabled', false);
        $('#export-crypto-note').text('Optional. The passphrase is not saved in the file or in this browser.');
      }
      openModal('#export-modal');
    });
    $('#export-encrypt').on('change', function () {
      if (this.checked) $('#export-crypto-fields').removeAttr('hidden');
      else $('#export-crypto-fields').attr('hidden', 'hidden');
    });
    $('#export-download').on('click', function () {
      buildExport().then(function (payload) {
        var json = JSON.stringify(payload, null, 2);
        $('#export-text').val(json);
        downloadText('calling-board-' + new Date().toISOString().slice(0, 10) + '.json', json);
        $('#export-error').text('');
      }).catch(function (err) {
        $('#export-error').text(err && err.message ? err.message : 'Could not export.');
      });
    });
    $('#export-copy').on('click', function () {
      buildExport().then(function (payload) {
        var json = JSON.stringify(payload, null, 2);
        $('#export-text').val(json);
        return copyText(json);
      }).then(function (ok) {
        $('#export-error').text(ok ? 'Copied.' : 'The text is in the box. Select it and copy.');
      }).catch(function (err) {
        $('#export-error').text(err && err.message ? err.message : 'Could not export.');
      });
    });
    $('#open-import').on('click', function () { $('#import-file').trigger('click'); });
    $('#import-file').on('change', function () {
      var file = this.files && this.files[0];
      this.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { handleImportText(String(reader.result || '')); };
      reader.readAsText(file);
    });
    $('#import-unlock').on('click', function () {
      var wrapper = pendingEncrypted;
      window.CMCrypto.decryptExport(wrapper, $('#import-passphrase').val()).then(function (state) {
        pendingEncrypted = null;
        closeModal('#import-modal');
        applyImportedState(state);
      }).catch(function (err) {
        $('#import-error').text(err && err.message ? err.message : 'Could not open that file.');
      });
    });
    $('#import-passphrase').on('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        $('#import-unlock').trigger('click');
      }
    });
  }

  $(function init() {
    if (typeof moment === 'function') $('#dateOfChanges').text(moment().format('MMMM Do YYYY'));
    bindEvents();
    decorateBoard();
    refreshSortable();
    measureToolbar();
    window.addEventListener('resize', measureToolbar);
    window.addEventListener('beforeunload', function () { if (readyToSave) saveNow(); });
    loadStoredState().then(function (state) {
      if (state && state.boardHtml) restoreState(state);
      readyToSave = true;
    }).catch(function () {
      readyToSave = true;
    });
  });
})(jQuery);
