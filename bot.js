const { Telegraf } = require('telegraf');
const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs/promises');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

// Ethereum NFT collection contract addresses
const CONTRACT_1 = '0xebcf83bde8e82708bfc027b2c32412283b6c23ff'; //og
const CONTRACT_2 = '0x7115a8ecc11336e594618ef85be0b920dfe205d3'; //3d

// Helper: Download image from URL
async function downloadImage(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data, 'binary');
}

// Helper: Combine two images side-by-side
async function combineImages(buffer1, buffer2) {
  const image1 = sharp(buffer1);
  const image2 = sharp(buffer2);

  const metadata1 = await image1.metadata();
  const metadata2 = await image2.metadata();

  const height = Math.max(metadata1.height, metadata2.height);
  const resized1 = await image1.resize({ height }).toBuffer();
  const resized2 = await image2.resize({ height }).toBuffer();

  return await sharp({
    create: {
      width: metadata1.width + metadata2.width,
      height: height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    }
  })
    .composite([
      { input: resized1, left: 0, top: 0 },
      { input: resized2, left: metadata1.width, top: 0 }
    ])
    .png()
    .toBuffer();
}

// Helper: Fetch token data from Magic Eden
async function getTokenData(contract, tokenId) {
  try {        //https://api-mainnet.magiceden.dev/v3/rtp/ethereum/tokens/v6?collection=0xebcf83bde8e82708bfc027b2c32412283b6c23ff&tokenIds=1
    const url = `https://api-mainnet.magiceden.dev/v3/rtp/ethereum/tokens/v6?collection=${contract}&tokenIds=${tokenId}`;
    console.log(url);

    const res = await axios.get(url);
    
    const tokenEntry = res.data?.tokens?.find(t => t?.token?.tokenId === String(tokenId));

    const token = tokenEntry?.token;
    console.log(JSON.stringify(res.data, null, 2));

    return {
      owner: token?.owner || 'Unknown',
      image: token?.image || null
    };
  } catch (err) {
    console.error('Magic Eden fetch error:', err.message);
    return { owner: 'Error', image: null };
  }
}

bot.command('scroto', async (ctx) => {
  const input = ctx.message.text.split(' ')[1];
  const id = parseInt(input, 10);

  if (!/^\d+$/.test(input) || id < 1 || id > 6666) {
    return ctx.reply('Come again?');
  }

  try {
    const [data1, data2] = await Promise.all([
      getTokenData(CONTRACT_1, id),
      getTokenData(CONTRACT_2, id)
    ]);

    if (!data1.image || !data2.image) {
      return ctx.reply('Could not fetch images from Magic Eden.');
    }

    const [img1, img2] = await Promise.all([
      downloadImage(data1.image),
      downloadImage(data2.image)
    ]);

    const combined = await combineImages(img1, img2);
    const tempFilePath = path.join(__dirname, `merged_\${id}.png`);
    await fs.writeFile(tempFilePath, combined);

    const caption = `Owners of Scroto # ${id}:
\`${data1.owner}\` (2D)
\`${data2.owner}\` (3D)`;

    await ctx.replyWithPhoto({ source: tempFilePath }, { caption });

    await fs.unlink(tempFilePath);
  } catch (err) {
    console.error(err);
    ctx.reply('Error fetching or merging images or owners.');
  }
});

bot.launch();
console.log('🤖 Bot is running...');
