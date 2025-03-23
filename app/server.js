const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');

dotenv.config(); // Load environment variables

const app = express();
const PORT = process.env.PORT || 8080; // Cloud Run requires PORT 8080
const SHEET_ID = process.env.SHEET_ID; // Use environment variable

// Ensure credentials are set
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("❌ GOOGLE_APPLICATION_CREDENTIALS is not set.");
    process.exit(1);
}

// Access Google Sheet
async function accessSheet(sheetId) {
    const doc = new GoogleSpreadsheet(sheetId);
    await doc.useServiceAccountAuth(require(process.env.GOOGLE_APPLICATION_CREDENTIALS));
    await doc.loadInfo();
    return doc.sheetsByIndex[0];
}

// Update Google Sheet
async function updateSheet(sheet, rowIndex, data) {
    const rows = await sheet.getRows();
    Object.keys(data).forEach(key => {
        rows[rowIndex][key] = data[key];
    });
    await rows[rowIndex].save();
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
        if (!SHEET_ID) {
            throw new Error("SHEET_ID is not set in environment variables.");
        }

        const sheet = await accessSheet(SHEET_ID);
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

        res.send('Scraping and updating completed.');
    } catch (error) {
        console.error("Error in /scrape:", error);
        res.status(500).send('Error: ' + error.message);
    }
});

// Ensure Cloud Run Compatibility
app.listen(PORT, "0.0.0.0", () => console.log(`✅ Server running on port ${PORT}`));
