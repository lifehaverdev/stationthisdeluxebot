const argsLength = 68; // 0x44
console.log('Args length:', argsLength);
console.log('Args length (hex):', '0x' + argsLength.toString(16));

const base = 0x6100523d8160233d3973n;
console.log('Base (hex):', '0x' + base.toString(16));

// Manual calculation
const shift56 = BigInt(argsLength) << 56n;
console.log('Args length << 56:', '0x' + shift56.toString(16));

const result = base + shift56;
console.log('Base + (argsLength << 56):', '0x' + result.toString(16));

// Expected result
const expected = 0x6100443d8160233d3973n;
console.log('Expected:', '0x' + expected.toString(16));
console.log('Match:', result === expected);

// Let's check what 0x44 << 56 should be
const manualShift = 0x44n << 56n;
console.log('0x44 << 56:', '0x' + manualShift.toString(16));

// Let's check what the difference should be
const diff = expected - base;
console.log('Expected - base:', '0x' + diff.toString(16));
console.log('This should equal 0x44 << 56:', diff === manualShift);
