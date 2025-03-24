const express = require('express');
const { google } = require('googleapis');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config(); // Load environment variables

const app = express();
const PORT = process.env.PORT || 8080;
const SHEET_ID = process.env.SHEET_ID;

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

// Authenticate and Set Global Google API Options
const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

google.options({ auth }); // 🔹 Set authentication globally

const sheets = google.sheets('v4');

// Function to Append Data to Google Sheets
async function appendToSheet(values) {
    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: 'A1:A1', // Placeholder, Google Sheets auto-detects next row
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [values] },
        });
        console.log("✅ Data appended successfully.");
    } catch (error) {
        console.error("❌ Error appending to Google Sheets:", error);
        throw error;
    }
}

// Scrape Invoice Data
async function scrapeInvoice(url) {
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

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

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'A1:Z1000', // Adjust based on your sheet size
        });

        const rows = response.data.values || [];
        for (let i = 0; i < rows.length; i++) {
            if (!rows[i][1]) { // Assuming column B is 'Grand Total', check if empty
                const invoiceData = await scrapeInvoice(rows[i][0]); // Assuming column A has links
                const formattedData = [
                    invoiceData.grandTotal,
                    invoiceData.businessName,
                    invoiceData.payDeadline,
                    invoiceData.items[0]?.name || '',
                    invoiceData.items[0]?.pricePerUnit || '',
                    invoiceData.items[0]?.totalPrice || ''
                ];
                await appendToSheet(formattedData);
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
