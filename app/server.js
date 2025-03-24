const express = require('express');
const { google } = require('googleapis');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
    console.error("❌ GOOGLE_APPLICATION_CREDENTIALS_BASE64 is not set.");
    process.exit(1);
}

const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf-8'));
const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
google.options({ auth });

const sheets = google.sheets('v4');

(async () => {
    const browser = await puppeteer.launch({ 
        headless: 'new',
        ignoreHTTPSErrors: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-software-rasterizer'
        ]
    });
    const page = await browser.newPage();

    // Load spreadsheet data
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'Sheet1!A:A',
    });

    const rows = data.values;
    for (const row of rows) {
        const invoiceLink = row[0];
        if (!invoiceLink) continue;

        await page.goto(invoiceLink, { waitUntil: 'networkidle2' });

        // Click 'Show all' if present
        const showAllSelector = 'button:has-text("Show all")';
        if (await page.$(showAllSelector)) {
            await page.click(showAllSelector);
            await page.waitForTimeout(2000);
        }

        // Extract invoice details
        const invoiceData = await page.evaluate(() => {
            const getText = (selector) => document.querySelector(selector)?.innerText.trim() || '';
            return {
                taskNumber: getText('.invoice-header h1'),
                grandTotal: getText('.grand-total'),
                invoiceNumber: getText('.invoice-number'),
                businessName: getText('.business-name'),
                payDeadline: getText('.pay-deadline')
            };
        });

        // Extract items list
        const items = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.invoice-items-list > div')).map(item => ({
                name: item.querySelector('h2')?.innerText.trim() || '',
                ppUnit: item.querySelector('.unit-price')?.innerText.trim() || '',
                tPrice: item.querySelector('.total-price')?.innerText.trim() || ''
            }));
        });

        // Update Google Sheets
        const updateValues = [
            [
                invoiceData.taskNumber,
                invoiceData.grandTotal,
                invoiceData.invoiceNumber,
                invoiceData.businessName,
                invoiceData.payDeadline,
                ...items.flatMap(item => [item.name, item.ppUnit, item.tPrice])
            ]
        ];

        await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `Sheet1!A${rows.indexOf(row) + 1}`,
            valueInputOption: 'RAW',
            resource: { values: updateValues }
        });
    }

    await browser.close();
})();

const app = express();
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`✅ Server running on port ${PORT}`));
