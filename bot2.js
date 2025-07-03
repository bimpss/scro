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

const ALCHEMY_API_KEY = process.env.ALCHEMY_PROJECT_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

const gateways = [
    //'https://cloudflare-ipfs.com/ipfs/',
    //'https://nftstorage.link/ipfs/',
    //'https://gateway.pinata.cloud/ipfs/',
    'https://ipfs.io/ipfs/',
];

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
    const hashPath = url.replace('ipfs://', '').replace(/^https?:\/\/[^/]+\/ipfs\//, '');

    for (const base of gateways) {
        const fullUrl = `${base}${hashPath}`;
        console.log(`🔁 Trying gateway: ${fullUrl}`);

        try {
            const response = await axios.get(fullUrl, {
                responseType: 'arraybuffer',
                timeout: 10000
            });

            console.log(`✅ Success: ${fullUrl}`);
            return Buffer.from(response.data, 'binary');
        } catch (err) {
            console.warn(`⚠️ Failed on ${base}: ${err.response?.status || err.message}`);
        }
    }

    throw new Error(`❌ Failed to fetch IPFS image from all gateways for: ${url}`);
}

// Helper: Combine two images side-by-side
async function combineImages(buffer1, buffer2) {
    const image1 = sharp(buffer1);
    const image2 = sharp(buffer2);

    // Get original metadata to determine max height
    const metadata1 = await image1.metadata();
    const metadata2 = await image2.metadata();
    const height = Math.max(metadata1.height, metadata2.height);

    // Resize both to the same height
    const resized1Buffer = await image1.resize({ height }).toBuffer();
    const resized2Buffer = await image2.resize({ height }).toBuffer();

    // Get new metadata after resize to get accurate width
    const resized1Meta = await sharp(resized1Buffer).metadata();
    const resized2Meta = await sharp(resized2Buffer).metadata();

    const totalWidth = resized1Meta.width + resized2Meta.width;

    return await sharp({
        create: {
            width: totalWidth,
            height: height,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 0 }
        }
    })
        .composite([
            { input: resized1Buffer, left: 0, top: 0 },
            { input: resized2Buffer, left: resized1Meta.width, top: 0 }
        ])
        .png()
        .toBuffer();
}

// Helper: Fetch token data from contract and metadata URI
async function getTokenData2D(contract, tokenId) {

    let owner = ""
    let ownerAddy = "";
    let which = "2D";

    try {
        // Fetch owner from contract
        owner = await contract.explicitOwnershipOf(tokenId);
        //console.log(2D owner: "+owner)
        ownerAddy = owner.addr
        console.log("2D ownerAddy: " + ownerAddy)

        const url = `https://eth-mainnet.g.alchemy.com/nft/v2/${ALCHEMY_API_KEY}/getNFTMetadata?contractAddress=0x7115a8ecc11336e594618ef85be0b920dfe205d3&tokenId=${tokenId}`;
        console.log("2D req url: " + url);
        const res = await axios.get(url);
        const imageUrl = res.data.metadata.image;
        console.log("2D img url: " + imageUrl);

        return {
            owner: ownerAddy,
            image: imageUrl,
            //name: metadata.name || `Token #${tokenId}`
        };

    } catch (err) {
        console.error(`Error fetching token ${tokenId} data from ${which} contract:`, err.message);
        return { owner: 'Unknown', image: null, name: `Token #${tokenId}` };
    }
}

async function getTokenData3D(tokenId) {

    let url = "";
    let imageUrl = "";
    let ownerAddy = "";
    let which = "3D";
    let ipfsImagesBase = "QmW95E3GsyQ6A6xjyQZCm3gvR4BNFUdu8BBpYm28tJ48VS";

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/115.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };

    //check if ipfsImagesBase+${token} exists
    for (const gateway of gateways) {
        url = `${gateway}${ipfsImagesBase}/${tokenId}.png`;
        try {
            const response = await axios.head(url, {
                headers,
                timeout: 10000,
                validateStatus: () => true, // Don't throw on non-200
            });
            if (response.status === 200) {
                console.log(`✅ Found image at: ${url}`);
                imageUrl = url;
                break;
            }
        } catch (err) {
            console.warn(`❌ Failed at ${url}:`, err.response?.status || err.message);
        }
    }
    console.log("3D ipfsImagesBase:", url);
    console.log("3D ipfsImagesBase URL:", imageUrl);

    try {
        ownerAddy = await axios.get(`https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_API_KEY}/getOwnersForNFT?contractAddress=0xebcf83bde8e82708bfc027b2c32412283b6c23ff&tokenId=${tokenId}`);
        //console.log("3D ownerAddy: " + ownerAddy)
        console.log("3D ownerAddy.owners[0]: " + ownerAddy.data.owners[0]);

        if (!imageUrl) {
            // Optionally fallback to Alchemy metadata if image wasn't found via IPFS gateway
            const metaUrl = `https://eth-mainnet.g.alchemy.com/nft/v2/${ALCHEMY_API_KEY}/getNFTMetadata?contractAddress=0xebcf83bde8e82708bfc027b2c32412283b6c23ff&tokenId=${tokenId}`;
            console.log("3D metadata URL:", metaUrl);
            const metaRes = await axios.get(metaUrl);
            imageUrl = metaRes.data.metadata?.image || null;
            console.log("3D fallback img url:", imageUrl);
        }

        /*
        const url = `https://eth-mainnet.g.alchemy.com/nft/v2/${ALCHEMY_API_KEY}/getNFTMetadata?contractAddress=0xebcf83bde8e82708bfc027b2c32412283b6c23ff&tokenId=${tokenId}`;
        console.log("3D req url: " + url);
        const res = await axios.get(url);
        const imageUrl = res.data.metadata.image;
        console.log("3D img url: " + imageUrl);
        */

        return {
            owner: ownerAddy.data.owners[0],
            image: imageUrl,
            //name: metadata.name || `Token #${tokenId}`
        };
    } catch (err) {
        console.error(`Error fetching token ${tokenId} data from ${which} contract:`, err.message);
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
            getTokenData2D(contract1, id),   //2d
            getTokenData3D(id)               //3d
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

        await ctx.replyWithPhoto({ source: tempFilePath }, {
            caption,
            parse_mode: 'Markdown'
        });

        await fs.unlink(tempFilePath);
    } catch (err) {
        console.error(err);
        ctx.reply('Error fetching or merging images or owners.');
    }
});

bot.launch();
console.log('🤖 Bot is running...');
