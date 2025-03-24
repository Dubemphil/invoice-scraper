const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');

dotenv.config(); // Load environment variables

const app = express();
const PORT = process.env.PORT || 8080; // Cloud Run requires PORT 8080
const SHEET_ID = process.env.SHEET_ID; // Use environment variable

// Ensure credentials are set
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
    console.error("❌ GOOGLE_APPLICATION_CREDENTIALS_BASE64 is not set.");
    process.exit(1);
}

// Decode Base64 credentials
const credentialsJSON = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8');
let credentials;
try {
    credentials = JSON.parse(credentialsJSON);
} catch (error) {
    console.error("❌ Failed to parse decoded credentials JSON:", error);
    process.exit(1);
}

// Access Google Sheet
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { GoogleAuth } = require('google-auth-library');

async function accessSheet(sheetId) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
        throw new Error("❌ GOOGLE_APPLICATION_CREDENTIALS_BASE64 is not set.");
    }

    // Decode Base64 credentials
    const credentialsJSON = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8');

    let credentials;
    try {
        credentials = JSON.parse(credentialsJSON);
    } catch (error) {
        throw new Error("❌ Failed to parse decoded credentials JSON: " + error.message);
    }

    // Authenticate using google-auth-library
    const auth = new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(sheetId);
    await doc.useOAuth2Client(await auth.getClient());
    await doc.loadInfo();
    
    return doc.sheetsByIndex[0]; // Return first sheet
}
// Scrape Invoice Data
async function scrapeInvoice(url) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });

    const invoiceData = await page.evaluate(() => {
        const grandTotal = document.querySelector('selector-for-total')?.innerText || '';
        const businessName = document.querySelector('selector-for-business-name')?.innerText || '';
        const payDeadline = document.querySelector('selector-for-pay-deadline')?.innerText || '';

        const items = Array.from(document.querySelectorAll('selector-for-items')).map(item => ({
            name: item.querySelector('selector-for-item-name')?.innerText || '',
            pricePerUnit: item.querySelector('selector-for-item-price')?.innerText || '',
            totalPrice: item.querySelector('selector-for-item-total')?.innerText || ''
        }));

        return { grandTotal, businessName, payDeadline, items };
    });

    await browser.close();
    return invoiceData;
}

// Main Route to Trigger Scraping
app.get('/scrape', async (req, res) => {
    try {
        const sheetId = process.env.SHEET_ID;
        if (!sheetId) {
            throw new Error("SHEET_ID is not set in environment variables.");
        }

        const sheet = await accessSheet(sheetId);
        const rows = await sheet.getRows();

        for (let i = 0; i < rows.length; i++) {
            if (!rows[i]['Grand Total']) { // Skip if already scraped
                const invoiceData = await scrapeInvoice(rows[i]['Invoice Link']);
                const formattedData = {
                    'Grand Total': invoiceData.grandTotal,
                    'Business Name': invoiceData.businessName,
                    'Pay Deadline': invoiceData.payDeadline,
                    'Item A1': invoiceData.items[0]?.name || '',
                    'Item A2': invoiceData.items[0]?.pricePerUnit || '',
                    'Item A3': invoiceData.items[0]?.totalPrice || ''
                };
                await updateSheet(sheet, i, formattedData);
            }
        }

        res.send('✅ Scraping and updating completed.');
    } catch (error) {
        console.error("❌ Error in /scrape:", error);
        res.status(500).send('Error: ' + error.message);
    }
});

// Ensure Cloud Run Compatibility
app.listen(PORT, "0.0.0.0", () => console.log(`✅ Server running on port ${PORT}`));
