/* Pure parser for a pasted LCR-style callings report. No network and no DOM. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CMParse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var VACANT = /^(null|undefined|vacant|none|n\/a|—|-)$/i;

  function rawChildren(org) {
    return org.children || org.childOrgs || org.subOrgs || org.subOrganizations || org.organizations || [];
  }

  function rawCallings(org) {
    return org.callings || org.positions || org.callingList || [];
  }

  function looksLikeOrg(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    var name = obj.defaultOrgName || obj.orgName || obj.displayName || obj.organizationName || obj.name;
    if (typeof name !== 'string' || !name.trim()) return false;
    return Array.isArray(obj.children) || Array.isArray(obj.childOrgs) || Array.isArray(obj.subOrgs) ||
      Array.isArray(obj.subOrganizations) || Array.isArray(obj.organizations) ||
      Array.isArray(obj.callings) || Array.isArray(obj.positions) || Array.isArray(obj.callingList);
  }

  function positionOf(calling) {
    var position = calling.position || calling.positionName || calling.callingName || calling.title;
    if (!position && calling.name && (calling.memberName != null || calling.member != null || calling.memberDisplayName != null)) {
      position = calling.name;
    }
    return String(position || '').trim();
  }

  function memberNameOf(calling) {
    var candidates = [calling.memberName, calling.memberDisplayName, calling.fullName, calling.memberFullName];
    if (calling.member && typeof calling.member === 'object') {
      candidates.push(calling.member.name, calling.member.memberName, calling.member.displayName, calling.member.fullName);
    } else if (typeof calling.member === 'string') {
      candidates.push(calling.member);
    }
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] == null) continue;
      var text = String(candidates[i]).trim();
      if (!text || VACANT.test(text)) continue;
      return text;
    }
    return null;
  }

  function activeDateOf(calling) {
    var value = calling.activeDate != null ? calling.activeDate : (calling.sustainedDate != null ? calling.sustainedDate : calling.sustained);
    if (value == null || value === '') return '';
    return value;
  }

  function normalizeCalling(calling) {
    return {
      position: positionOf(calling) || 'Calling',
      memberName: memberNameOf(calling),
      activeDate: activeDateOf(calling),
      setApart: calling.setApart != null ? calling.setApart : (calling.setApartDate || '')
    };
  }

  function normalizeOrg(org) {
    var children = rawChildren(org);
    if (!Array.isArray(children)) children = [];
    var callings = rawCallings(org);
    if (!Array.isArray(callings)) callings = [];
    return {
      defaultOrgName: String(org.defaultOrgName || org.orgName || org.displayName || org.organizationName || org.name || 'Organization').trim(),
      children: children.filter(looksLikeOrg).map(normalizeOrg),
      callings: callings.filter(function (item) {
        return item && typeof item === 'object' && positionOf(item);
      }).map(normalizeCalling)
    };
  }

  function countCallings(list) {
    var total = 0;
    if (!Array.isArray(list)) return 0;
    list.forEach(function (org) {
      if (!org || typeof org !== 'object') return;
      var callings = rawCallings(org);
      if (Array.isArray(callings)) total += callings.length;
      total += countCallings(rawChildren(org));
    });
    return total;
  }

  function arrayLooksLikeOrgs(list) {
    if (!Array.isArray(list) || !list.length) return false;
    var matches = 0;
    for (var i = 0; i < list.length; i++) if (looksLikeOrg(list[i])) matches++;
    return matches >= 1 && matches >= Math.ceil(list.length * 0.6);
  }

  function extractOrganizations(data) {
    var best = null;
    var bestScore = -1;
    function walk(node, depth) {
      if (node == null || depth > 14) return;
      if (Array.isArray(node)) {
        if (arrayLooksLikeOrgs(node)) {
          var score = countCallings(node);
          if (score > bestScore) {
            best = node;
            bestScore = score;
          }
        }
        for (var i = 0; i < node.length; i++) walk(node[i], depth + 1);
        return;
      }
      if (typeof node === 'object') {
        var keys = Object.keys(node);
        for (var k = 0; k < keys.length; k++) walk(node[keys[k]], depth + 1);
      }
    }
    walk(data, 0);
    if (!best && looksLikeOrg(data)) best = [data];
    if (!best) return null;
    return best.filter(looksLikeOrg).map(normalizeOrg);
  }

  return {
    extractOrganizations: extractOrganizations,
    looksLikeOrg: looksLikeOrg
  };
});
