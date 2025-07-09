const express = require('express');
const multer = require('multer');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const sharp = require('sharp'); //Llamar al editor de imagenes 

require('dotenv').config();

const clarifai =require('clarifai-nodejs');
const { Workflow } = clarifai


const TELEGRAM_TOKEN = process.env.KEY_TELEGRAM_TOKEN;
const CHAT_ID = process.env.KEY_CHAT_ID;

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de carpeta de subidas

// Configurar carpeta de subidas
const UPLOAD_FOLDER = './uploads';
if (!fs.existsSync(UPLOAD_FOLDER)) {
    fs.mkdirSync(UPLOAD_FOLDER);
}

// Middleware para CORS
app.use(cors());

/**
 * PRUEBA DE ENVIO DE IMAGEN A TELEGRAM
 * fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: 'Hola desde mi servidor!' })
})
.then(res => res.json())
.then(json => console.log(json))
.catch(err => console.error(err));

 */

// Configuración de Multer para multipart/form-data
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_FOLDER);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({ storage });

// Configuración de Clarifai
const PAT = process.env.KEY_PAT; // Reemplaza con tu PAT
const workflowUrl = 'https://clarifai.com/clarifai/main/workflows/General-Detection ';

// Crear instancia del workflow de Clarifai
const OCRWorkflow = new Workflow({
    url: workflowUrl,
    authConfig: {
        pat: PAT,
    },
});

async function sendImageToTelegram(imageBuffer, filename = 'image.jpg') {
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
    formData.append('photo', blob, filename);

    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto?chat_id=${CHAT_ID}`, {
        method: 'POST',
        body: formData
    });

    const result = await response.json();

    if (!result.ok) {
        console.error("Error al enviar a Telegram:", result);
        return false;
    }
    return true;
}

async function drawBoundingBoxes(imageBuffer, regions) {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    const imageWidth = metadata.width;
    const imageHeight = metadata.height;

    let svgRects = '';
    let svgTexts = '';

    regions.forEach( region => {
        if(region.regionInfo && region.regionInfo.boundingBox){
            const bbox = region.regionInfo.boundingBox;

            const top = Math.round(bbox.topRow * imageHeight);
            const left = Math.round(bbox.leftCol * imageWidth);
            const bottom = Math.round(bbox.bottomRow * imageHeight);
            const right = Math.round(bbox.rightCol * imageWidth);

            const rectWidth = right - left;
            const rectHeight = bottom - top;

            //Dibuja el rectangulo
            svgRects += `<rect x="${left}" y="${top}" width="${rectWidth}" height="${rectHeight}" stroke="#FF0000" stroke-width="5" fill="none" />`;

            let conceptName = 'Persona';
            svgTexts += `<text x="${left + 5}" y="${top < 20 ? top + 20 : top - 5}" font-family="Arial" font-size="20" fill="#FF0000" stroke="#000000" stroke-width="0.5">${conceptName}</text>`;
        }
    });

    const svg = `<svg width="${imageWidth}" height="${imageHeight}">${svgRects}${svgTexts}</svg>`

    const outputBuffer = await image.composite([{
        input: Buffer.from(svg),
        top: 0,
        left: 0,
        blend: 'over'
    }]).toBuffer();

    return outputBuffer;
}

// Endpoint para recibir imagen como multipart/form-data
app.post('/upload', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No se recibió ninguna imagen.' });
    }

    const filePath = req.file.path;
    try {
        const imageBuffer = fs.readFileSync(filePath);
        // Llamar a Clarifai
        const prediction = await OCRWorkflow.predictByBytes(imageBuffer, "image");
        //const lastOutputIndex = prediction.resultsList[0].outputsList.length - 1;
        const results = prediction.resultsList[0].outputsList[0].data.regionsList;
        const objects = results.map(region => ({
            regionInfo: region.regionInfo,
            value: region.data.conceptsList[0].name,
        }))
        const objectFiltered = objects.filter(obj => obj.value === 'person');

        //DIBUJAR RECTANGULOS
        const imageBufferWithBoxes = await drawBoundingBoxes(imageBuffer, objectFiltered);

        //ENVIAR A TELEGRAM
        const success = await sendImageToTelegram(imageBufferWithBoxes, req.file.originalname);

        fs.unlinkSync(filePath); // Borrar después de enviar

        if (success) {
            res.json({ message: 'Imagen enviada a Telegram correctamente.', results: objects });
        } else {
            res.status(500).json({ error: 'Error al enviar la imagen a Telegram.' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Hubo un problema procesando la imagen.' });
    }
});
// Endpoint para recibir imagen en Base64 dentro de JSON
app.use(bodyParser.json({ limit: '10mb' })); // Ajusta el límite según el tamaño de la imagen


// Endpoint /upload-base64 - JSON con imagen en Base64
app.post('/upload-base64', async (req, res) => {
    const { image } = req.body;

    if (!image) {
        return res.status(400).json({ error: 'No se recibió la imagen en Base64.' });
    }

    // Separar encabezado y contenido Base64
    const matches = image.match(/^data:image\/jpeg;base64,(.+)$/); // Ajustado para jpeg
    let base64Data;

    if (matches && matches.length === 2) {
        base64Data = matches[1];
    } else {
        base64Data = image;
    }

    try {
        // Convertir Base64 a Buffer
        const imageBuffer = Buffer.from(base64Data, 'base64');
        
        
        //Llamar a  LA IA
        const prediction = await OCRWorkflow.predictByBytes(imageBuffer, "image");
        //const lastOutputIndex = prediction.resultsList[0].outputsList.length - 1;
        //console.log(prediction);
        const results = prediction.resultsList[0].outputsList[0].data.regionsList;
        
        const objects = results.map(region => ({
            regionInfo: region.regionInfo,
            value: region.data.conceptsList[0].name,
        }))
        const objectFiltered = objects.filter(obj => obj.value === 'person');

        //DIBUJAR RECTANGULOS
        const imageBufferWithBoxes = await drawBoundingBoxes(imageBuffer, objectFiltered);

        // Usar FormData para enviar a Telegram
        const formData = new FormData();
        const blob = new Blob([imageBufferWithBoxes], { type: 'image/jpeg' });
        formData.append('photo', blob);

        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto?chat_id=${CHAT_ID}`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.ok) {
            res.json({ message: 'Imagen en Base64 enviada a Telegram correctamente.' , results: results});
        } else {
            res.status(500).json({ error: 'Error al enviar la imagen a Telegram.' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Hubo un problema procesando la imagen.' });
    }
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});