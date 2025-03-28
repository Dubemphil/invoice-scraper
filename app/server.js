const express = require('express');
const { google } = require('googleapis');
const puppeteer = require('puppeteer');
const vision = require('@google-cloud/vision');
const dotenv = require('dotenv');
import open from 'open';
const readline = require('readline');

dotenv.config();

const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf-8'));
const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
});
google.options({ auth });

const sheets = google.sheets('v4');
const drive = google.drive({ version: 'v3', auth });
const visionClient = new vision.ImageAnnotatorClient({ credentials });
const app = express();
const PORT = process.env.PORT || 8080;

async function getDriveFolderId() {
    const { data } = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.folder'",
        fields: 'files(id, name)',
    });

    console.log("Available Folders:");
    data.files.forEach((file, index) => console.log(`${index + 1}. ${file.name} (${file.id})`));

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question('Enter the number of the folder you want to select: ', (answer) => {
            const selectedFolder = data.files[parseInt(answer) - 1];
            rl.close();
            resolve(selectedFolder ? selectedFolder.id : null);
        });
    });
}

async function createSpreadsheet() {
    const title = "Extracted Links";
    const response = await sheets.spreadsheets.create({
        resource: { properties: { title } },
    });
    const sheetId = response.data.spreadsheetId;

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        resource: {
            requests: [
                { addSheet: { properties: { title: "Sheet1" } } },
                { addSheet: { properties: { title: "Sheet2" } } },
                { addSheet: { properties: { title: "Sheet3" } } }
            ]
        }
    });
    return sheetId;
}

async function extractLinksFromImages(sheetId, folderId) {
    const { data } = await drive.files.list({
        q: `'${folderId}' in parents and mimeType contains 'image/'`,
        fields: 'files(id, name)',
    });

    let extractedLinks = [];
    for (const file of data.files) {
        const [result] = await visionClient.textDetection(`https://drive.google.com/uc?id=${file.id}`);
        const detectedText = result.fullTextAnnotation ? result.fullTextAnnotation.text : '';
        const urlMatch = detectedText.match(/https?:\/\/[\w\-._~:/?#@!$&'()*+,;=%]+/g);
        if (urlMatch) extractedLinks.push([urlMatch[0]]);
    }

    await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: 'Sheet1!A2:A',
        valueInputOption: 'RAW',
        resource: { values: extractedLinks },
    });
    return sheetId;
}

async function scrapeInvoices(sheetId) {
    const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'Sheet1!A:A',
    });

    const rows = data.values;
    if (!rows || rows.length === 0) return;

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    let currentRowSheet2 = 2;
    let currentRowSheet3 = 2;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const invoiceLink = rows[rowIndex][0];
        if (!invoiceLink) continue;

        await page.goto(invoiceLink, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));

        const invoiceData = await page.evaluate(() => {
            const getText = (xpath) => {
                const element = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                return element ? element.innerText.trim() : 'N/A';
            };
            return {
                businessName: getText('/html/body/app-root/app-verify-invoice/div/section[1]/div/ul/li[1]'),
                invoiceNumber: getText('/html/body/app-root/app-verify-invoice/div/section[1]/div/div[1]/h4'),
                grandTotal: getText('/html/body/app-root/app-verify-invoice/div/section[1]/div/div[2]/h1'),
                vat: getText('/html/body/app-root/app-verify-invoice/div/section[1]/div/div[2]/small[2]/strong'),
                invoiceType: getText('/html/body/app-root/app-verify-invoice/div/section[2]/div/div/div/div[5]/p')
            };
        });

        await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `Sheet2!A${currentRowSheet2}:E${currentRowSheet2}`,
            valueInputOption: 'RAW',
            resource: { values: [[invoiceData.businessName, invoiceData.invoiceNumber, invoiceData.grandTotal, invoiceData.vat, invoiceData.invoiceType]] }
        });
        currentRowSheet2++;
    }
    await browser.close();
}

app.get('/start', async (req, res) => {
    try {
        const folderId = await getDriveFolderId();
        if (!folderId) {
            return res.status(400).json({ success: false, message: "No folder selected" });
        }
        let sheetId = await createSpreadsheet();
        sheetId = await extractLinksFromImages(sheetId, folderId);
        await scrapeInvoices(sheetId);
        res.json({ success: true, message: "Process completed successfully", sheetId });
    } catch (error) {
        console.error("❌ Error during process:", error);
        res.status(500).json({ success: false, message: "Process failed", error: error.toString() });
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`✅ Server running on port ${PORT}`));
