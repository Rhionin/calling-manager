/* Calling and release status, plus sacrament-meeting sentences. No DOM. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CMPipeline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var CALL_FLOW = [
    { id: 'proposed', label: 'Proposed', next: 'Get bishopric approval' },
    { id: 'approved', label: 'Approved by the bishopric', next: 'Extend the calling' },
    { id: 'extended', label: 'Extended', next: 'Record whether the calling was accepted' },
    { id: 'accepted', label: 'Accepted', next: 'Sustain in sacrament meeting' },
    { id: 'sustained', label: 'Sustained', next: 'Set apart' },
    { id: 'set-apart', label: 'Set apart', next: 'Record the calling in LCR' },
    { id: 'recorded', label: 'Recorded in LCR', next: 'Done until the next LCR paste' },
    { id: 'declined', label: 'Declined', next: 'Choose a different person' }
  ];
  var RELEASE_FLOW = [
    { id: 'proposed', label: 'Proposed', next: 'Get bishopric approval' },
    { id: 'approved', label: 'Approved by the bishopric', next: 'Announce the release in sacrament meeting' },
    { id: 'released', label: 'Released / announced', next: 'Record the release in LCR' },
    { id: 'recorded', label: 'Recorded in LCR', next: 'Done until the next LCR paste' }
  ];
  var CALL_ORDER = ['proposed', 'approved', 'extended', 'accepted', 'sustained', 'set-apart', 'recorded'];
  var RELEASE_ORDER = ['proposed', 'approved', 'released', 'recorded'];

  function flow(type) {
    return type === 'release' ? RELEASE_FLOW : CALL_FLOW;
  }

  function statusInfo(type, status) {
    var list = flow(type);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === status) return list[i];
    }
    return list[0];
  }

  function nextStatus(type, status) {
    if (type !== 'release' && status === 'extended') return null;
    if (status === 'declined' || status === 'recorded') return null;
    var order = type === 'release' ? RELEASE_ORDER : CALL_ORDER;
    var index = order.indexOf(status);
    if (index < 0 || index === order.length - 1) return null;
    return order[index + 1];
  }

  function whereClause(item) {
    return item.orgName ? ' in the ' + item.orgName : '';
  }

  function releaseSentence(item) {
    return item.memberName + ' has been released as ' + item.callingName + whereClause(item) +
      '. Those who wish to express thanks may do so by the uplifted hand.';
  }

  function sustainSentence(item) {
    return item.memberName + ' has been called as ' + item.callingName + whereClause(item) +
      '. Those who can sustain ' + item.memberName + ', please manifest it.';
  }

  function buildProgram(items) {
    var releases = [];
    var calls = [];
    (items || []).forEach(function (item) {
      if (!item || item.status === 'declined') return;
      if (item.type === 'release') releases.push(item);
      else if (item.type === 'call') calls.push(item);
    });
    var lines = [];
    if (releases.length) {
      lines.push('Releases');
      lines.push('');
      releases.forEach(function (item) { lines.push(releaseSentence(item)); });
    }
    if (calls.length) {
      if (lines.length) lines.push('');
      lines.push('Sustainings');
      lines.push('');
      calls.forEach(function (item) { lines.push(sustainSentence(item)); });
    }
    return lines.join('\n').trim();
  }

  function suggestForSacrament(item) {
    if (!item) return false;
    if (item.type === 'release') return item.status === 'approved';
    if (item.type === 'call') return item.status === 'accepted';
    return false;
  }

  function countsAsOpen(item) {
    return item && item.status !== 'recorded' && item.status !== 'declined';
  }

  return {
    CALL_FLOW: CALL_FLOW,
    RELEASE_FLOW: RELEASE_FLOW,
    flow: flow,
    statusInfo: statusInfo,
    nextStatus: nextStatus,
    releaseSentence: releaseSentence,
    sustainSentence: sustainSentence,
    buildProgram: buildProgram,
    suggestForSacrament: suggestForSacrament,
    countsAsOpen: countsAsOpen
  };
});
