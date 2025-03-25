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

// Function to convert a number to a Google Sheets column letter (e.g., 27 -> "AA")
const getColumnLetter = (colNum) => {
    let column = "";
    while (colNum > 0) {
        let remainder = (colNum - 1) % 26;
        column = String.fromCharCode(65 + remainder) + column;
        colNum = Math.floor((colNum - 1) / 26);
    }
    return column;
};

app.get('/scrape', async (req, res) => {
    let browser;
    try {
        browser = await puppeteer.launch({
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
            range: 'Sheet1',
        });

        const rows = data.values || [];
        let extractedData = [];

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const invoiceLink = rows[rowIndex][0];
            if (!invoiceLink || !/^https?:\/\//.test(invoiceLink)) {
                console.warn(`⚠️ Skipping invalid URL: ${invoiceLink}`);
                continue;
            }

            console.log(`🔄 Processing row ${rowIndex + 1} - ${invoiceLink}`);

            try {
                await page.goto(invoiceLink, { waitUntil: 'networkidle2', timeout: 60000 });
            } catch (navError) {
                console.error(`❌ Failed to navigate to ${invoiceLink}:`, navError);
                continue;
            }

            // Ensure page is fully loaded
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Click 'Show all' button if present
            try {
                const [showAllButton] = await page.$x("//button[contains(text(), 'Show all')]");
                if (showAllButton) {
                    console.log("✅ 'Show all' button found, clicking...");
                    await showAllButton.click();
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                    console.warn("⚠️ 'Show all' button not found.");
                }
            } catch (clickError) {
                console.warn("⚠️ Error clicking 'Show all' button:", clickError);
            }

            // Extract invoice details
            const invoiceData = await page.evaluate(() => {
                const getText = (selector) => {
                    const element = document.querySelector(selector);
                    return element ? element.innerText.trim() : 'N/A';
                };

                return {
                    invoiceNumber: getText('.invoice-title')?.match(/\d+\/\d+/)?.[0] || 'N/A',
                    grandTotal: getText('.invoice-amount h1 strong'),
                    businessName: getText('.invoice-basic-info--business-name')
                };
            });

            console.log(`✅ Extracted Data for row ${rowIndex + 1}:`, invoiceData);

            // Extract items list
            let items = [];
            try {
                await page.waitForSelector('.invoice-items-list', { timeout: 10000 });
                items = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('.invoice-item')).map(item => {
                        const heading = item.querySelector('.invoice-item--heading');
                        return {
                            name: heading?.querySelector('.invoice-item--title')?.innerText.trim() || 'N/A',
                            ppUnit: heading?.querySelector('.invoice-item--unit-price')?.innerText.trim() || 'N/A',
                            tPrice: heading?.querySelector('.invoice-item--price')?.innerText.trim() || 'N/A'
                        };
                    });
                });
            } catch (itemsError) {
                console.warn(`⏳ Items list not found for row ${rowIndex + 1}, proceeding without items.`);
            }

            console.log(`✅ Extracted Items for row ${rowIndex + 1}:`, items);

            // Find the first empty column in the current row
            const existingRow = rows[rowIndex] || [];
            let startColumnIndex = existingRow.length + 1; // Start after existing columns

            // Calculate required columns
            const numColumns = 3 + items.length * 3; // Invoice fields (3) + 3 columns per item
            const endColumnIndex = startColumnIndex + numColumns - 1;
            const startColumnLetter = getColumnLetter(startColumnIndex);
            const endColumnLetter = getColumnLetter(endColumnIndex);
            const range = `Sheet1!${startColumnLetter}${rowIndex + 1}:${endColumnLetter}${rowIndex + 1}`;

            // Prepare update values
            const updateValues = [
                [
                    invoiceData.invoiceNumber,
                    invoiceData.grandTotal,
                    invoiceData.businessName,
                    ...items.flatMap((item) => [item.name, item.ppUnit, item.tPrice])
                ]
            ];

            await sheets.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: range,
                valueInputOption: 'RAW',
                resource: { values: updateValues }
            });

            extractedData.push({ invoiceData, items });
        }

        res.json({ success: true, message: "Scraping completed", data: extractedData });

    } catch (error) {
        console.error("❌ Error during scraping:", error);
        res.status(500).json({ success: false, message: "Scraping failed", error: error.toString() });

    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`✅ Server running on port ${PORT}`));
