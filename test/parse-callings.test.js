const assert = require('assert');
const CMParse = require('../js/parse-callings.js');
require('../js/sample-data.js');

const sample = CMParse.extractOrganizations(global.SAMPLE_WARD_CALLINGS);
assert.ok(sample && sample.length >= 8, 'sample should yield organizations');
const bishopric = sample.find((org) => org.defaultOrgName === 'Bishopric');
assert.ok(bishopric, 'Bishopric present');
assert.strictEqual(bishopric.callings[0].memberName, 'Sample, Avery');
assert.strictEqual(bishopric.callings[2].memberName, null);

const primary = sample.find((org) => org.defaultOrgName === 'Primary');
assert.strictEqual(primary.children.length, 2);
assert.strictEqual(primary.children[0].defaultOrgName, 'Nursery');
assert.strictEqual(primary.children[0].callings[0].memberName, 'Strawman, Parker');
assert.strictEqual(primary.children[0].callings[1].memberName, null);

const wrapped = CMParse.extractOrganizations({
  unitData: {
    organizations: [
      {
        orgName: 'Sample Organization',
        positions: [
          { positionName: 'Example Role', member: { fullName: 'Demo, Dana' }, sustainedDate: '20200101', setApart: false }
        ],
        children: []
      }
    ]
  }
});
assert.strictEqual(wrapped.length, 1);
assert.strictEqual(wrapped[0].defaultOrgName, 'Sample Organization');
assert.strictEqual(wrapped[0].callings[0].position, 'Example Role');
assert.strictEqual(wrapped[0].callings[0].memberName, 'Demo, Dana');
assert.strictEqual(wrapped[0].callings[0].activeDate, '20200101');

assert.strictEqual(CMParse.extractOrganizations({ hello: 'world' }), null);
assert.strictEqual(CMParse.extractOrganizations('not json'), null);

const allowed = /^(Sample|Example|Demo|Fictional|Placeholder|Notreal|Pretend|Imaginary|Madeup|Testonly|Synthetic|Nobody|Faux|Hypothetical|Mockdata|Strawman|Paper|Standin|Cartoon|Dummy|Unassigned|Candidate|Prospect), /;
function walk(orgs) {
  orgs.forEach((org) => {
    org.callings.forEach((calling) => {
      if (calling.memberName) assert.match(calling.memberName, allowed, calling.memberName);
    });
    walk(org.children || []);
  });
}
walk(sample);
global.SAMPLE_NAMES_TO_CONSIDER.forEach((name) => assert.match(name, allowed, name));

console.log('parse-callings.test.js ok');
