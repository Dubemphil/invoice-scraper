const express = require('express');
const puppeteer = require('puppeteer');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const creds = require('./credentials.json'); // Google service account credentials

const app = express();
const PORT = process.env.PORT || 3000;
const SHEET_ID = 'your_google_sheet_id'; // Replace with actual Google Sheet ID

// Function to access Google Sheet
async function accessSheet() {
    const doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();
    return doc.sheetsByIndex[0]; // First sheet
}

// Function to update Google Sheet
async function updateSheet(sheet, rowIndex, data) {
    const rows = await sheet.getRows();
    Object.keys(data).forEach(key => {
        rows[rowIndex][key] = data[key];
    });
    await rows[rowIndex].save();
}

// Function to scrape invoice details
async function scrapeInvoice(url) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Extract required values
    const invoiceData = await page.evaluate(() => {
        const getText = (selector) => document.querySelector(selector)?.innerText.trim() || '';

        return {
            businessName: getText('.invoice-basic-info--business-name'),  // Business Name
            invoiceNumber: getText('.invoice-title')?.match(/\d+\/\d+/)?.[0] || '', // Extract Invoice Number
            grandTotal: getText('.invoice-amount h1 strong'),  // Grand Total
            vat: getText('.invoice-amount')?.match(/VAT amount:\s*([\d,.]+)\s*LEK/)?.[1] || '', // Extract VAT
            invoiceType: getText('.invoice-type')  // Invoice Type
        };
    });

    await browser.close();
    return invoiceData;
}

// Express route to start scraping and update Google Sheet
app.get('/scrape', async (req, res) => {
    try {
        const sheet = await accessSheet();
        const rows = await sheet.getRows();

        for (let i = 0; i < rows.length; i++) {
            if (!rows[i]['Grand Total']) { // Only scrape if Grand Total is empty
                const invoiceData = await scrapeInvoice(rows[i]['Invoice Link']);
                
                const formattedData = {
                    'Business Name': invoiceData.businessName,
                    'Invoice Number': invoiceData.invoiceNumber,
                    'Grand Total': invoiceData.grandTotal,
                    'VAT': invoiceData.vat,
                    'Invoice Type': invoiceData.invoiceType
                };

                await updateSheet(sheet, i, formattedData);
            }
        }

        res.send('✅ Scraping and updating completed.');
    } catch (error) {
        res.status(500).send('❌ Error: ' + error.message);
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
