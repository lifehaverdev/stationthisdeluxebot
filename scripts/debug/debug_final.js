const argsLength = 68; // 0x44
console.log('Args length:', argsLength);
console.log('Args length (hex):', '0x' + argsLength.toString(16));

const base = 0x6100523d8160233d3973n;
console.log('Base (hex):', '0x' + base.toString(16));

// Expected result
const expected = 0x6100443d8160233d3973n;
console.log('Expected:', '0x' + expected.toString(16));

// Calculate the difference
const diff = base - expected;
console.log('Base - Expected:', '0x' + diff.toString(16));

// Check if this equals 0xe00000000000000
const expectedDiff = 0xe00000000000000n;
console.log('Expected difference:', '0x' + expectedDiff.toString(16));
console.log('Match:', diff === expectedDiff);

// So the correct calculation should be: base - 0xe00000000000000
const result = base - expectedDiff;
console.log('Base - 0xe00000000000000:', '0x' + result.toString(16));
console.log('Match with expected:', result === expected);

// Now let's see what 0xe00000000000000 represents
console.log('\n0xe00000000000000 analysis:');
console.log('0xe00000000000000 =', 0xe00000000000000n);
console.log('This is 0xe << 56 =', (0xen << 56n));
console.log('So the correct calculation is: base - (0xe << 56)');

// But wait, 0xe = 14, and 68 - 14 = 54 = 0x36
// Let me check if the pattern is different
console.log('\nPattern check:');
console.log('0x52 - 0x44 =', 0x52 - 0x44);
console.log('0x52 - 0x44 =', '0x' + (0x52 - 0x44).toString(16));
