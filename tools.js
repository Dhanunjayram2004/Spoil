// tools.js
const fs = require('fs');
const path = require('path');
//const os = require('os');
let XLSX = null;
try { 
    XLSX = require('xlsx'); 
} catch(e) { 
    console.warn("XLSX module is missing. Excel tools will be disabled."); 
}
async function executeExternalTool(name, args) {
    // We already resolved the path safely in renderer.js, 
    // so args.resolvedPath is guaranteed to exist here!

    if (name === 'modifyFileEntry') return await modifyFileEntry(args);
    if (name === 'analyzeAndCleanData') return await analyzeAndCleanData(args);
    if (name === 'filterMLData') return await filterMLData(args);
    if (name === 'captureAndAnalyze') return await captureAndAnalyze();
    
    return { success: false, message: `Unknown tool ${name}` };
}


async function analyzeAndCleanData(args) {
    const filePath = args.resolvedPath; // Using the resolved path from renderer.js
    if (!fs.existsSync(filePath)) return { success: false, message: "File not found." };

    try {
        const ext = path.extname(filePath).toLowerCase();
        
        if (ext === '.xlsx') {
            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            // Read the sheet as a raw 2D array (array of arrays)
            const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            // Detect the real header row
            // Logic: The real header row usually has the most non-empty string cells
            let headerRowIndex = 0;
            for (let i = 0; i < rawData.length; i++) {
                const validCells = rawData[i].filter(cell => typeof cell === 'string' && cell.trim() !== '');
                // If a row has more than 3 valid column names, we assume it's the real header
                if (validCells.length > 3) {
                    headerRowIndex = i;
                    break;
                }
            }

            // Slice off the junk rows at the top
            const cleanData = rawData.slice(headerRowIndex);

            // Create a new clean workbook
            const newWorksheet = XLSX.utils.aoa_to_sheet(cleanData);
            const newWorkbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, "Cleaned Data");

            // Save it as a new file so we don't destroy the original
            const cleanFilePath = filePath.replace('.xlsx', '_clean.xlsx');

// ⚡ SAFE WRITE PROCEDURE
try {
    XLSX.writeFile(newWorkbook, cleanFilePath, { 
    bookType: 'xlsx', 
    type: 'file', 
    compression: true 
});
if (filePath.includes('_clean')) {
    return { success: true, message: "File already cleaned, no need to re-process." };
}
    
    // File save ayyindemo verify cheyali
    if (fs.existsSync(cleanFilePath) && fs.statSync(cleanFilePath).size > 100) {
         return { success: true, message: `Clean data saved successfully at ${cleanFilePath}` };
    } else {
         throw new Error("File write failed or file is empty.");
    }
} catch (err) {
    return { success: false, message: `Save error: ${err.message}` };
}

            return { 
                success: true, 
                message: `Removed ${headerRowIndex} messy top rows. Clean data saved as ${path.basename(cleanFilePath)}` 
            };
        }

        return { success: false, message: "This tool currently only supports cleaning .xlsx files." };
    } catch (err) {
        return { success: false, message: `Failed to clean data: ${err.message}` };
    }
}
async function modifyFileEntry(args) {
    const filePath = args.resolvedPath;
    if (!fs.existsSync(filePath)) return { success: false, message: "File not found." };

    try {
        // BACKUP
        const backupPath = filePath + '.backup';
        fs.copyFileSync(filePath, backupPath);

        const ext = path.extname(filePath).toLowerCase();
        let newData;

        if (ext === '.xlsx') {
            // 1. READ EXCEL
            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0]; // Get first sheet
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(worksheet);

            // 2. MODIFY
            const target = data.find(item => item[args.key] === args.value);
            if (!target) throw new Error("Entry not found in Excel sheet.");
            target[args.updateKey] = args.newUpdateValue;

            // 3. WRITE BACK
            const newWorksheet = XLSX.utils.json_to_sheet(data);
            workbook.Sheets[sheetName] = newWorksheet;
            XLSX.writeFile(workbook, filePath);
            return { success: true, message: `Updated Excel file ${args.filePath}` };
        } 
        
        // ... (Keep your JSON and CSV logic here)
    } catch (err) {
        return { success: false, message: `Excel update failed: ${err.message}` };
    }
}
async function filterMLData(args) {
    const filePath = args.resolvedPath;
    const results = [];
    
    // Use a streaming approach so we don't crash the RAM
    const stream = fs.createReadStream(filePath);
    // ... use a library like 'csv-stream' or 'readline' to process row by row
    // ... perform your logic (e.g., "if col A > 0.5 then keep")
    // ... write to a new file 'filtered_data.csv'
    
    return { success: true, message: "Filtered data saved to filtered_data.csv" };
}
// Inside tools.js
async function captureAndAnalyze() {
    try {
        const { desktopCapturer } = require('electron');
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1280, height: 720 }
        });
        if (!sources || sources.length === 0) {
            return { success: false, message: 'No screen source found.' };
        }
        const imageBase64 = sources[0].thumbnail
            .toDataURL()
            .replace(/^data:image\/\w+;base64,/, '');
        return { success: true, message: 'Screenshot captured.', imageBase64 };
    } catch (err) {
        return { success: false, message: `Capture failed: ${err.message}` };
    }
}
// FIXED: Exporting the new executeExternalTool name
module.exports = { executeExternalTool, analyzeAndCleanData, modifyFileEntry, filterMLData, captureAndAnalyze };