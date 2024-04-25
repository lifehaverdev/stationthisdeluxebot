function checkBlacklist(wallet) {
    const blacklist = [
        "FtSobG6Bw36QnZ6gbbvj2ssYC9xnj5L6tKRN7rEfWzwQ",
        "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
        "ECzNcuvo6ww28n41JHb84Pd4u8ofuKPkdCVPMp1uiSGU",
    ]
    if(blacklist.includes(wallet)){
        return true;
    } else {
        return false;
    }
}

module.exports = {
    checkBlacklist
}