const argsLength = 68; // 0x44
console.log('Args length:', argsLength);
console.log('Args length (hex):', '0x' + argsLength.toString(16));

const base = 0x6100523d8160233d3973n;
console.log('Base (hex):', '0x' + base.toString(16));

// Try different shift amounts
for (let shift = 40; shift <= 64; shift += 4) {
    const prefix = base + (BigInt(argsLength) << BigInt(shift));
    console.log(`Shift ${shift}: 0x${prefix.toString(16)}`);
}

// The correct prefix should be 0x6100443d8160233d3973
const correct = 0x6100443d8160233d3973n;
console.log('Correct prefix:', '0x' + correct.toString(16));

// Let's see what shift gives us the correct result
for (let shift = 40; shift <= 64; shift += 4) {
    const prefix = base + (BigInt(argsLength) << BigInt(shift));
    if (prefix === correct) {
        console.log(`Found correct shift: ${shift}`);
        break;
    }
}
