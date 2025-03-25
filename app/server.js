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
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/scrape', async (req, res) => {
    try {
        const browser = await puppeteer.launch({ 
            headless: true,
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
        let extractedData = [];

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const invoiceLink = rows[rowIndex][0];
            if (!invoiceLink || !/^https?:\/\//.test(invoiceLink)) {
                console.warn(`⚠️ Skipping invalid URL: ${invoiceLink}`);
                continue;
            }

            try {
                await page.goto(invoiceLink, { waitUntil: 'networkidle2', timeout: 30000 });
            } catch (navError) {
                console.error(`❌ Failed to navigate to ${invoiceLink}:`, navError);
                continue;
            }

            // Click 'Show all' button if present using querySelector
            try {
                const showAllButton = await page.$("button:has-text('Show all')");
                if (showAllButton) {
                    await showAllButton.click();
                    await page.waitForTimeout(2000);
                }
            } catch (clickError) {
                console.error("⚠️ Error clicking 'Show all' button:", clickError);
            }

            // Extract invoice details
            const invoiceData = await page.evaluate(() => {
                const getText = (selector) => {
                    const element = document.querySelector(selector);
                    return element ? element.innerText.trim() : 'N/A';
                };
                return {
                    taskNumber: getText('.invoice-header h1'),
                    invoiceNumber: getText('.invoice-number'),
                    businessName: getText('.business-name'),
                    grandTotal: getText('.grand-total'),
                    payDeadline: getText('.pay-deadline')
                };
            });

            // Extract items list
            const items = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('.invoice-items-list > div')).map(item => ({
                    name: item.querySelector('h2')?.innerText.trim() || 'N/A',
                    ppUnit: item.querySelector('.unit-price')?.innerText.trim() || 'N/A',
                    tPrice: item.querySelector('.total-price')?.innerText.trim() || 'N/A'
                }));
            });

            // Prepare update values (Ensuring column A remains unchanged)
            const updateValues = [
                [
                    rows[rowIndex][0], // Keep column A unchanged
                    invoiceData.taskNumber,
                    invoiceData.invoiceNumber,
                    invoiceData.businessName,
                    invoiceData.grandTotal,
                    invoiceData.payDeadline,
                    ...items.flatMap(item => [item.name, item.ppUnit, item.tPrice])
                ]
            ];

            await sheets.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: `Sheet1!B${rowIndex + 1}`, // Ensure updates start from column B
                valueInputOption: 'RAW',
                resource: { values: updateValues }
            });

            extractedData.push({ invoiceData, items });
        }

        await browser.close();
        res.json({ success: true, message: "Scraping completed", data: extractedData });
    } catch (error) {
        console.error("❌ Error during scraping:", error);
        res.status(500).json({ success: false, message: "Scraping failed", error: error.toString() });
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`✅ Server running on port ${PORT}`));
