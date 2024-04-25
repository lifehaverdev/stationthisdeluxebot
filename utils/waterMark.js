const Jimp = require('jimp')

async function addWaterMark (filename) {
    try {
        waterOptions = {
            opacity: .8,
            dstPath: filename,
            ratio: .5
        }
        const main = await Jimp.read(filename);
        const watermark = await Jimp.read('./ms2black.png');
        const [newHeight, newWidth] = getDimensions(main.getHeight(), main.getWidth(), watermark.getHeight(), watermark.getWidth(), waterOptions.ratio);
        watermark.resize(newWidth, newHeight);
        const positionX = (main.getWidth() - newWidth) / 8;     //Centre aligned
        const positionY = (main.getHeight() - newHeight) - 10/// 2;   //Centre aligned
        watermark.opacity(waterOptions.opacity);
        main.composite(watermark,
            positionX,
            positionY,
            Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE);
        await main.quality(100).writeAsync(waterOptions.dstPath);
    } catch (err) {
        throw err;
    }
}

async function writeToDisc(filename){
    const dest = `./tmp/${chatId}_${Date.now()}.png`;
    // if(isUrl(filename)){
    //     dest = `./tmp/${chatId}_${Date.now()}.png`;
    // } else {
    //     dest = filename;
    // }
    try {
        waterOptions = {
            opacity: 1,
            dstPath: dest,
            ratio: 1
        }
        const main = await Jimp.read(filename);
        console.log('okay we have main');
        const watermark = await Jimp.read('./ms2disc.png');
        console.log('okay we have disc');
        //const [newHeight, newWidth] = getDimensions(main.getHeight(), main.getWidth(), watermark.getHeight(), watermark.getWidth(), waterOptions.ratio);
        main.resize(1024, 1024);
        const positionX = 0;     //Centre aligned
        const positionY = 0;/// 2;   //Centre aligned
        watermark.opacity(waterOptions.opacity);
        main.composite(watermark,
            positionX,
            positionY,
            Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE);
        await main.quality(100).writeAsync(waterOptions.dstPath);

        let filenames = []
        filenames.push(dest);
        return filenames;
    } catch (err) {
        console.log(err);
        throw err;
        
    }
}


const getDimensions = (H, W, h, w, ratio) => {
    let hh, ww;
    if ((H / W) < (h / w)) {    //GREATER HEIGHT
        hh = ratio * H;
        ww = hh / h * w;
    } else {                //GREATER WIDTH
        ww = ratio * W;
        hh = ww / w * h;
    }
    return [hh, ww];
}

module.exports = {
    addWaterMark,
    writeToDisc
}