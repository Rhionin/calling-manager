const assert = require('assert');
const CMPipeline = require('../js/pipeline.js');

assert.strictEqual(CMPipeline.nextStatus('call', 'proposed'), 'approved');
assert.strictEqual(CMPipeline.nextStatus('call', 'extended'), null);
assert.strictEqual(CMPipeline.nextStatus('call', 'accepted'), 'sustained');
assert.strictEqual(CMPipeline.nextStatus('call', 'recorded'), null);
assert.strictEqual(CMPipeline.nextStatus('release', 'approved'), 'released');
assert.strictEqual(CMPipeline.nextStatus('release', 'released'), 'recorded');

const release = {
  type: 'release',
  memberName: 'Sample, Avery',
  callingName: 'Bishop',
  orgName: 'Bishopric',
  status: 'approved'
};
const call = {
  type: 'call',
  memberName: 'Unassigned, Uma',
  callingName: 'Ward Clerk',
  orgName: 'Bishopric',
  status: 'accepted'
};
assert.strictEqual(
  CMPipeline.releaseSentence(release),
  'Sample, Avery has been released as Bishop in the Bishopric. Those who wish to express thanks may do so by the uplifted hand.'
);
assert.strictEqual(
  CMPipeline.sustainSentence(call),
  'Unassigned, Uma has been called as Ward Clerk in the Bishopric. Those who can sustain Unassigned, Uma, please manifest it.'
);

const program = CMPipeline.buildProgram([
  call,
  release,
  { type: 'call', memberName: 'Candidate, Cory', callingName: 'Organist', orgName: 'Other Callings', status: 'declined' }
]);
assert.ok(program.indexOf('Releases') < program.indexOf('Sustainings'));
assert.ok(program.includes('has been released as Bishop'));
assert.ok(program.includes('has been called as Ward Clerk'));
assert.ok(!program.includes('Candidate, Cory'));
assert.strictEqual(CMPipeline.suggestForSacrament(release), true);
assert.strictEqual(CMPipeline.suggestForSacrament(call), true);
assert.strictEqual(CMPipeline.countsAsOpen({ status: 'recorded' }), false);
assert.strictEqual(CMPipeline.countsAsOpen({ status: 'proposed' }), true);

console.log('pipeline.test.js ok');
