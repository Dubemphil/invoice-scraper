// googlesheet.js
const { GoogleSpreadsheet } = require('google-spreadsheet');
const creds = require('./credentials.json'); // Google service account credentials

async function accessSheet(sheetId) {
    const doc = new GoogleSpreadsheet(sheetId);
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();
    return doc.sheetsByIndex[0];
}

async function updateSheet(sheet, rowIndex, data) {
    const rows = await sheet.getRows();
    Object.keys(data).forEach(key => {
        rows[rowIndex][key] = data[key];
    });
    await rows[rowIndex].save();
}

module.exports = { accessSheet, updateSheet };

// scraper.js
const puppeteer = require('puppeteer');

async function scrapeInvoice(url) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    // Extract data
    const invoiceData = await page.evaluate(() => {
        const grandTotal = document.querySelector('selector-for-total')?.innerText || '';
        const businessName = document.querySelector('selector-for-business-name')?.innerText || '';
        const payDeadline = document.querySelector('selector-for-pay-deadline')?.innerText || '';
        
        const items = Array.from(document.querySelectorAll('selector-for-items')).map(item => {
            return {
                name: item.querySelector('selector-for-item-name')?.innerText || '',
                pricePerUnit: item.querySelector('selector-for-item-price')?.innerText || '',
                totalPrice: item.querySelector('selector-for-item-total')?.innerText || ''
            };
        });
        
        return { grandTotal, businessName, payDeadline, items };
    });

    await browser.close();
    return invoiceData;
}

module.exports = { scrapeInvoice };

// server.js
const express = require('express');
const { accessSheet, updateSheet } = require('./googlesheet');
const { scrapeInvoice } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;
const SHEET_ID = 'your_google_sheet_id';

app.get('/scrape', async (req, res) => {
    try {
        const sheet = await accessSheet(SHEET_ID);
        const rows = await sheet.getRows();

        for (let i = 0; i < rows.length; i++) {
            if (!rows[i]['Grand Total']) { // Check if already scraped
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
        res.status(500).send('Error: ' + error.message);
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
