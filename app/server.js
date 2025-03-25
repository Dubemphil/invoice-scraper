const express = require('express');
const { google } = require('googleapis');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');

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

            console.log(`🔄 Processing row ${rowIndex + 1} - ${invoiceLink}`);

            try {
                await page.goto(invoiceLink, { waitUntil: 'networkidle2', timeout: 30000 });
            } catch (navError) {
                console.error(`❌ Failed to navigate to ${invoiceLink}:`, navError);
                continue;
            }

            // Click 'Show all' button if present
            try {
                const showAllButtons = await page.$x("//button[contains(text(), 'Show all')]");
                if (showAllButtons.length > 0) {
                    console.log("✅ 'Show all' button found, clicking...");
                    await showAllButtons[0].click();
                    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for items to load
                } else {
                    console.warn("⚠️ 'Show all' button not found.");
                }
            } catch (clickError) {
                console.error("⚠️ Error clicking 'Show all' button:", clickError);
            }

            // Ensure page is fully loaded before extraction
            await page.waitForTimeout(3000); // Extra wait time

            // Extract invoice details
            const invoiceData = await page.evaluate(() => {
                const getText = (selector) => {
                    const element = document.querySelector(selector);
                    return element ? element.innerText.trim() : 'N/A';
                };

                return {
                    taskNumber: getText('.invoice-header h1') || getText('.task-number span'),
                    invoiceNumber: getText('.invoice-number span') || getText('.invoice-id span'),
                    businessName: getText('.business-name span') || getText('.company-name span'),
                    grandTotal: getText('.grand-total span') || getText('.total-amount span'),
                    payDeadline: getText('.pay-deadline span') || getText('.due-date span')
                };
            });

            console.log(`✅ Extracted Data for row ${rowIndex + 1}:`, invoiceData);

            // Ensure items are fully loaded before extraction
            await page.waitForSelector('.invoice-items-list', { timeout: 5000 }).catch(() => console.warn("⏳ Items list not found"));

            // Extract items list
            const items = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('.invoice-items-list > div')).map(item => ({
                    name: item.querySelector('h2')?.innerText.trim() || 'N/A',
                    ppUnit: item.querySelector('.unit-price')?.innerText.trim() || 'N/A',
                    tPrice: item.querySelector('.total-price')?.innerText.trim() || 'N/A'
                }));
            });

            console.log(`✅ Extracted Items for row ${rowIndex + 1}:`, items);

            // Prepare update values
            const updateValues = [
                [
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
                range: `Sheet1!B${rowIndex + 1}:Z${rowIndex + 1}`,
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
