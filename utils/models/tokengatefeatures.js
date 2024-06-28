const features = [
    {
        name: 'set base prompt',
        gate: 100000,
    },
    {
        name: 'watermark + assist',
        gate: 200000,
    },
    {
        name: 'autoi2i + interrogate',
        gate: 300000
    },
    {
        name: 'style transfer + controlnet',
        gate: 400000
    },
    {
        name: 'stablediffusion3 txt2img',
        gate: 500000
    },
    {
        name: 'image to video',
        gate: 600000
    }

]

module.exports = { features }