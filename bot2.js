require('dotenv').config();

const { Telegraf } = require('telegraf');
const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs/promises');
const path = require('path');
const { ethers } = require('ethers');
const infuraProjectId = process.env.INFURA_PROJECT_ID;
//console.log(infuraProjectId);
const provider = new ethers.JsonRpcProvider(
  `https://mainnet.infura.io/v3/${infuraProjectId}`
);
provider.getBlockNumber().then(console.log).catch(console.error);
console.log(provider);

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

// ERC-721 minimal ABI for ownerOf and tokenURI
const ERC721A_ABI_2D = [
  "function explicitOwnershipOf(uint256 tokenId) view returns (tuple(address addr, uint64 startTimestamp, bool burned, uint24 extraData))",
  "function tokenURI(uint256 tokenId) view returns (string)"
];

const ERC721A_ABI_3D = [
  "function ownerOf(uint256 tokenId) view returns uint64 startTimestamp, bool burned, uint24 extraData))",
  "function tokenURI(uint256 tokenId) view returns (string)"
];

// Ethereum NFT collection contract addresses
const CONTRACT_1 = '0xebcf83bde8e82708bfc027b2c32412283b6c23ff'; // 2D og
const CONTRACT_2 = '0x7115a8ecc11336e594618ef85be0b920dfe205d3'; // 3D

const contract1 = new ethers.Contract(CONTRACT_1, ERC721A_ABI_2D, provider);
const contract2 = new ethers.Contract(CONTRACT_2, ERC721A_ABI_3D, provider);

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

// Helper: Fetch token data from contract and metadata URI
async function getTokenData(contract, tokenId, whichContract) {
    
    console.log("tokenId: "+tokenId)
    console.log("whichContract: "+whichContract)

    try {
    // Fetch owner from contract
    if (whichContract=="2D"){
    const owner = await contract.explicitOwnershipOf(tokenId);
    const ownerAddy = ownership.addr    
    } else
    {
    const ownerAddy = await contract.ownerOf(tokenId);
    }

    // Fetch tokenURI from contract
    let tokenUri = await contract.tokenURI(tokenId);

    // Convert ipfs:// to https://ipfs.io/ipfs/
    if (tokenUri.startsWith('ipfs://')) {
      tokenUri = tokenUri.replace('ipfs://', 'https://ipfs.io/ipfs/');
    }

    // Fetch metadata JSON
    const metadataResponse = await axios.get(tokenUri);
    const metadata = metadataResponse.data;

    // Metadata image might be ipfs:// too, fix that
    let imageUrl = metadata.image || metadata.image_url || null;
    if (imageUrl && imageUrl.startsWith('ipfs://')) {
      imageUrl = imageUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
    }

    return {
      ownerAddy,
      image: imageUrl,
      name: metadata.name || `Token #${tokenId}`
    };
  } catch (err) {
    console.error(`Error fetching token ${tokenId} data from contract:`, err.message);
    return { owner: 'Unknown', image: null, name: `Token #${tokenId}` };
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
      getTokenData(contract1, id, "2D"),
      getTokenData(contract2, id, "3D")
    ]);

    if (!data1.image || !data2.image) {
      return ctx.reply('Could not fetch images from token metadata.');
    }

    const [img1, img2] = await Promise.all([
      downloadImage(data1.image),
      downloadImage(data2.image)
    ]);

    const combined = await combineImages(img1, img2);
    const tempFilePath = path.join(__dirname, `merged_${id}.png`);
    await fs.writeFile(tempFilePath, combined);

    const caption = `Owners of Scroto #${id}:
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
