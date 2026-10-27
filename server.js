const express = require('express');
const multer = require('multer');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

require('dotenv').config();

const TELEGRAM_TOKEN = process.env.KEY_TELEGRAM_TOKEN;
const CHAT_ID = process.env.KEY_CHAT_ID;

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de la carpeta de subidas
const UPLOAD_FOLDER = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_FOLDER)) {
    fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });
}

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// Configuración de Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_FOLDER);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);

        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype && file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos de imagen.'));
        }
    }
});

// Validar configuración de Telegram
if (!TELEGRAM_TOKEN || !CHAT_ID) {
    console.error(
        'ERROR: Configura KEY_TELEGRAM_TOKEN y KEY_CHAT_ID en el archivo .env'
    );
}

// Enviar imagen directamente a Telegram
async function sendImageToTelegram(imageBuffer, filename = 'image.jpg') {
    if (!TELEGRAM_TOKEN || !CHAT_ID) {
        throw new Error('Falta configurar el token o el chat ID de Telegram.');
    }

    const formData = new FormData();

    const blob = new Blob([imageBuffer], {
        type: 'application/octet-stream'
    });

    formData.append('chat_id', CHAT_ID);
    formData.append('photo', blob, filename);

    const response = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`,
        {
            method: 'POST',
            body: formData
        }
    );

    const result = await response.json();

    if (!response.ok || !result.ok) {
        throw new Error(
            `Telegram rechazó la imagen: ${JSON.stringify(result)}`
        );
    }

    return result;
}

// Endpoint 1: recibir imagen mediante multipart/form-data
app.post('/upload', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            error: 'No se recibió ninguna imagen.'
        });
    }

    const filePath = req.file.path;

    try {
        const imageBuffer = fs.readFileSync(filePath);

        await sendImageToTelegram(
            imageBuffer,
            req.file.originalname || 'image.jpg'
        );

        return res.json({
            success: true,
            message: 'Imagen enviada a Telegram correctamente.'
        });

    } catch (err) {
        console.error('Error en /upload:', err.message);

        return res.status(500).json({
            success: false,
            error: 'No se pudo enviar la imagen a Telegram.'
        });

    } finally {
        // Eliminar el archivo temporal
        fs.promises.unlink(filePath).catch(err => {
            console.error('Error eliminando archivo temporal:', err.message);
        });
    }
});

// Endpoint 2: recibir imagen mediante JSON y Base64
app.post('/upload-base64', async (req, res) => {
    const { image } = req.body || {};

    if (!image || typeof image !== 'string') {
        return res.status(400).json({
            success: false,
            error: 'No se recibió la imagen en Base64.'
        });
    }

    try {
        // Admitir imágenes con encabezado data:image/...;base64,
        const matches = image.match(
            /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/s
        );

        const base64Data = matches ? matches[2] : image;

        // Validar la codificación Base64
        if (
            !base64Data ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data) ||
            base64Data.length % 4 !== 0
        ) {
            return res.status(400).json({
                success: false,
                error: 'La imagen Base64 no tiene un formato válido.'
            });
        }

        const imageBuffer = Buffer.from(base64Data, 'base64');

        if (imageBuffer.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'La imagen está vacía.'
            });
        }

        if (imageBuffer.length > 10 * 1024 * 1024) {
            return res.status(413).json({
                success: false,
                error: 'La imagen supera el límite de 10 MB.'
            });
        }

        // Enviar la imagen sin analizarla ni modificarla
        await sendImageToTelegram(imageBuffer, 'captura.jpg');

        return res.json({
            success: true,
            code: 1004,
            message: 'Imagen en Base64 enviada a Telegram correctamente.'
        });

    } catch (err) {
        console.error('Error en /upload-base64:', err.message);

        return res.status(500).json({
            success: false,
            code: 1001,
            error: 'No se pudo enviar la imagen a Telegram.'
        });
    }
});

// Manejo de errores de Multer
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;

        return res.status(status).json({
            success: false,
            error: err.code === 'LIMIT_FILE_SIZE'
                ? 'La imagen supera el límite de 10 MB.'
                : err.message
        });
    }

    if (err) {
        return res.status(400).json({
            success: false,
            error: err.message || 'Error al recibir la imagen.'
        });
    }

    next();
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
```
