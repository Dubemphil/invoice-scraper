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
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

        const sheetId = process.env.GOOGLE_SHEET_ID;
        const { data } = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: 'Sheet1!A:A',
        });

        const rows = data.values;
        let extractedData1 = [];
        let extractedData2 = [];
        let currentRowSheet3 = 2;

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
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Script 1 Extraction
            const invoiceData1 = await page.evaluate(() => {
                const getText = (xpath) => {
                    const element = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    return element ? element.innerText.trim() : 'N/A';
                };
                return {
                    businessName: getText('/html/body/app-root/app-verify-invoice/div/section[1]/div/ul/li[1]'),
                    invoiceNumber: getText('/html/body/app-root/app-verify-invoice/div/section[1]/div/div[1]/h4'),
                    grandTotal: getText('/html/body/app-root/app-verify-invoice/div/section[1]/div/div[2]/h1')
                };
            });
            extractedData1.push(invoiceData1);
            await sheets.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: `Sheet2!A${rowIndex + 1}:C${rowIndex + 1}`,
                valueInputOption: 'RAW',
                resource: { values: [[invoiceData1.businessName, invoiceData1.invoiceNumber, invoiceData1.grandTotal]] }
            });

            // Script 2 Extraction
            const invoiceData2 = await page.evaluate(() => {
                const getText = (xpath) => {
                    const element = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    return element ? element.innerText.trim().replace('TVSH', 'VAT') : 'N/A';
                };
                return {
                    businessName: getText('/html/body/app-root/app-verify-invoice/div/section[1]/div/ul/li[1]'),
                    invoiceNumber: getText('/html/body/app-root/app-verify-invoice/div/section[1]/div/div[1]/h4')
                };
            });
            extractedData2.push(invoiceData2);
            await sheets.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: `Sheet3!A${currentRowSheet3}:B${currentRowSheet3}`,
                valueInputOption: 'RAW',
                resource: { values: [[invoiceData2.businessName, invoiceData2.invoiceNumber]] }
            });
            currentRowSheet3++;
        }

        await browser.close();
        res.json({ success: true, message: "Scraping completed", data: { extractedData1, extractedData2 } });
    } catch (error) {
        console.error("❌ Error during scraping:", error);
        res.status(500).json({ success: false, message: "Scraping failed", error: error.toString() });
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`✅ Server running on port ${PORT}`));
