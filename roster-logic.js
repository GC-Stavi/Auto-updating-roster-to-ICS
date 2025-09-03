// NOTE: The main roster parsing and ICS generation script is assumed to be in an external file
// or would be placed here. The following includes the UI interaction logic.

// Global variable to hold the modal element references
const breachInfoModal = document.getElementById('breachInfoModal');
const aboutInfoModal = document.getElementById('aboutInfoModal'); // New modal reference
// --- START: CABIN CREW IMPLANT ---
const cabinCrewInfoModal = document.getElementById('cabinCrewInfoModal');
// --- END: CABIN CREW IMPLANT ---

function toggleDarkMode() {
    const body = document.body;
    const btn = document.getElementById('darkModeBtn');
    const isDark = body.classList.toggle('dark-mode');
    btn.textContent = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    localStorage.setItem('darkMode', isDark ? 'dark' : 'light');
}

window.onload = function () {
    const saved = localStorage.getItem('darkMode');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldDark = saved === 'dark' || (!saved && prefersDark);
    if (shouldDark) {
        document.body.classList.add('dark-mode');
        document.getElementById('darkModeBtn').textContent = 'Switch to Light Mode';
    }

    // Add event listener to close modals when clicking outside content
    breachInfoModal.addEventListener('click', function(event) {
        if (event.target === breachInfoModal) {
            hideBreachInfoModal();
        }
    });
    aboutInfoModal.addEventListener('click', function(event) { // New event listener for about modal
        if (event.target === aboutInfoModal) {
            hideAboutInfoModal();
        }
    });
    // --- START: CABIN CREW IMPLANT ---
    cabinCrewInfoModal.addEventListener('click', function(event) {
        if (event.target === cabinCrewInfoModal) {
            hideCabinCrewInfoModal();
        }
    });
    // --- END: CABIN CREW IMPLANT ---
};

function pad(n) {
    return n.toString().padStart(2, '0');
}

// Helper for month parsing needed for Date objects
function parseMonthString(monStr) {
    const months = {
        Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
        Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
    };
    return months[monStr];
}

function cleanHeaderLines(lines) {
    // This function is still useful for cleaning repeated headers inside the roster data.
    const knownHeaders = [
        'Duty Date',
        'CrewName',
        'CrewID',
        '~',
        'DutyHours',
        'FlightDutyPeriod',
        'DaysOff',
        // 'SBY', // REMOVED: This was too broad and incorrectly filtered valid SBY-FC entries.
        'CredHours',
        'ObsHours',
        'FlightHours',
        'Layover',
        'WorkingDuties',
        'PaxHours'
    ];
    
    return lines.filter(line =>
        !knownHeaders.some(h =>
            line.replace(/\s+/g, '').includes(h.replace(/\s+/g, ''))
        )
    );
}

/**
 * Extracts details and hours/credits from a buffer of lines representing a single roster entry.
 * This function is now shared by generateICS, parseRosterData, and generatePrintout.
 * @param {Array<string>} buffer - Array of lines for a single roster entry.
 * @returns {object} An object containing parsed roster data for one entry.
 */
function processRosterEntryBuffer(buffer) {
    const rowData = Array(11).fill(''); // Updated to 11 columns for the new FDP column
    // Corrected the split to handle any amount of whitespace, making it more robust for pasted text.
    const initialSplit = buffer[0].trim().split(/\s+/);
    // Ensure initialSplit has at least 5 elements before accessing index 4
    for (let i = 0; i < initialSplit.length && i < 5; i++) rowData[i] = initialSplit[i];

    const [dayStr, monStr, yyyyVal] = rowData[0].split(/[\/\s]/);
    let currentYear = new Date().getFullYear();
    if (yyyyVal && !isNaN(Number(yyyyVal))) {
        currentYear = Number(yyyyVal);
    }

    const date = new Date(currentYear, parseMonthString(monStr), Number(dayStr));

    let summaryParts = [];
    let detailsLines = [];
    const timeSummaryRegex = /^(\d{1,2}:\d{2}|-|)[ \t]*(\d{1,2}:\d{2}|-|)[ \t]*(\d{1,2}:\d{2}|-|)[ \t]*(\d{1,2}:\d{2}|-|)[ \t]*(\d{1,2}:\d{2}|-|)$|^(\d{1,2}:\d{2})$/; // Handle both 5-column and single-column formats

    // Process buffer to separate details from final time summary line
    for (let k = 1; k < buffer.length; k++) {
        const line = buffer[k]; // Preserve leading/trailing spaces for proper splitting later
        const trimmedLine = line.trim();
        if (timeSummaryRegex.test(trimmedLine)) { // Test on trimmed line
            // Handle single time value (like TRG entries)
            if (/^\d{1,2}:\d{2}$/.test(trimmedLine)) {
                summaryParts = [trimmedLine, '', '', '', ''];
            } else {
                summaryParts = line.split(/\t| {2,}/); // Split original line
            }
        } else {
            detailsLines.push(line);
        }
    }
    
    // Set the details content for the row, joining all lines and then trimming
    const detailsContent = detailsLines.join('\n').trim();
    rowData[5] = detailsContent; // Details column

    for (let i = 0; i < summaryParts.length; i++) rowData[6 + i] = summaryParts[i];

    const entry = {
        date: date,
        dateString: rowData[0],
        dutyType: rowData[1] ? rowData[1].trim() : '',
        briefTime: rowData[2] ? rowData[2].trim() : '',
        debriefTime: rowData[3] ? rowData[3].trim() : '',
        layover: rowData[4] ? rowData[4].trim() : '',
        details: rowData[5] ? rowData[5].trim() : '',
        dutyHours: rowData[6] ? rowData[6].trim() : '',
        flightDutyPeriod: rowData[7] ? rowData[7].trim() : '', // New FDP column
        flightHours: rowData[8] ? rowData[8].trim() : '', // Shifted from index 7 to 8
        paxHours: rowData[9] ? rowData[9].trim() : '', // Shifted from index 8 to 9
        creditHours: rowData[10] ? rowData[10].trim() : '', // Shifted from index 9 to 10
        yyyy: currentYear // Include year for ICS generation if needed
    };

    // Add new properties for rule checking, now done directly in this parser
    entry.isActualDuty = isDayOfDuty(entry);
    entry.isEarlyStart = entry.isActualDuty && parseTime(entry.briefTime) < parseTime('06:00');
    entry.consecutiveFlagged = false; // To be set by the consecutive early start check

    return entry;
}

// --- NEW ICS GENERATION LOGIC ---
function generateICS() {
    gtag('event', 'button_click', { 'button_name': 'export_calendar' });
    const rosterEntries = parseRosterData();
    if (!rosterEntries || rosterEntries.length === 0) {
        return alert("Paste your roster first or check its format.");
    }

    // Map Airport codes to IANA Timezone Names
    const timezoneMap = {
        'BNE': 'Australia/Brisbane', 'ROK': 'Australia/Brisbane', 'ISA': 'Australia/Brisbane',
        'HTI': 'Australia/Brisbane', 'HIR': 'Australia/Brisbane', 'TSV': 'Australia/Brisbane',
        'EMD': 'Australia/Brisbane', 'PPP': 'Australia/Brisbane', 'MKY': 'Australia/Brisbane',
        'CNS': 'Australia/Brisbane',
        'NTL': 'Australia/Sydney', 'CBR': 'Australia/Sydney', 'SYD': 'Australia/Sydney',
        'MEL': 'Australia/Melbourne',
        'DRW': 'Australia/Darwin', 'GTS': 'Australia/Darwin', 'ASP': 'Australia/Darwin',
        'ADL': 'Australia/Adelaide',
        'PER': 'Australia/Perth'
    };
    const homeBaseTimezone = 'Australia/Brisbane';

    let events = [];

    rosterEntries.forEach((entry, i) => {
        // Determine the location of the duty
        let dutyLocationCode = '';
        if (i > 0 && rosterEntries[i - 1].layover) {
            // Location is the previous day's layover
            dutyLocationCode = rosterEntries[i - 1].layover.trim().toUpperCase();
        } else {
            // First day or back at home base, find first departure airport
            const departureMatch = entry.details.match(/([A-Z]{3})\s*\//);
            if (departureMatch) {
                dutyLocationCode = departureMatch[1];
            }
        }

        const eventTimezone = timezoneMap[dutyLocationCode] || homeBaseTimezone;
        const yyyy = entry.yyyy;
        const mm = pad(entry.date.getMonth() + 1);
        const dd = pad(entry.date.getDate());

        let eventString = 'BEGIN:VEVENT\n';
        eventString += `UID:roster-${yyyy}${mm}${dd}-${entry.dutyType}@roster.local\n`;
        eventString += `DTSTAMP:${yyyy}${mm}${dd}T000000Z\n`;

        // Handle timed duties vs. all-day duties
        if (entry.briefTime && entry.briefTime !== '-' && entry.debriefTime && entry.debriefTime !== '-') {
            // This is a timed event (FLY, MVO, etc.)
            const formatTime = (t) => t.replace(/:/g, '') + '00';
            const dtStart = `${yyyy}${mm}${dd}T${formatTime(entry.briefTime)}`;
            const dtEnd = `${yyyy}${mm}${dd}T${formatTime(entry.debriefTime)}`;

            eventString += `SUMMARY:${entry.dutyType} ${entry.briefTime} ${entry.details.split('\n')[0]}\n`;
            eventString += `DTSTART;TZID=${eventTimezone}:${dtStart}\n`;
            eventString += `DTEND;TZID=${eventTimezone}:${dtEnd}\n`;
            eventString += `DESCRIPTION:Duty: ${entry.dutyType}\\nBrief: ${entry.briefTime}\\nDebrief: ${entry.debriefTime}\\nDetails: ${entry.details.replace(/\n/g, '\\n')}\n`;
            eventString += `LOCATION:${dutyLocationCode || 'BNE'}\n`;
            
            // Add a 30-minute reminder
            eventString += 'BEGIN:VALARM\n';
            eventString += 'TRIGGER:-PT30M\n';
            eventString += 'ACTION:DISPLAY\n';
            eventString += 'DESCRIPTION:Duty Reminder\n';
            eventString += 'END:VALARM\n';

        } else {
            // This is an all-day event (RDO, GREY, SBY, etc.)
            const nextDay = new Date(entry.date);
            nextDay.setDate(nextDay.getDate() + 1);
            const endYYYY = nextDay.getFullYear();
            const endMM = pad(nextDay.getMonth() + 1);
            const endDD = pad(nextDay.getDate());
            
            eventString += `SUMMARY:${entry.dutyType}\n`;
            eventString += `DTSTART;VALUE=DATE:${yyyy}${mm}${dd}\n`;
            eventString += `DTEND;VALUE=DATE:${endYYYY}${endMM}${endDD}\n`; // End date is exclusive for all-day events
            if (entry.details) {
                eventString += `DESCRIPTION:${entry.details.replace(/\n/g, '\\n')}\n`;
            }
        }

        eventString += 'END:VEVENT';
        events.push(eventString);
    });

    // Assemble the final ICS string. No VTIMEZONE block is needed.
    const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nCALSCALE:GREGORIAN\nPRODID:-//RosterCheck//EN\n${events.join('\n')}\nEND:VCALENDAR`;

    const blob = new Blob([ics.replace(/\n/g, "\r\n")], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'roster_export.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}


// --- NEW BREACH CHECKING FUNCTIONALITY ---

function parseTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) {
        return NaN;
    }
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

function formatMinutesToHHMM(totalMinutes) {
    if (isNaN(totalMinutes)) return 'Invalid Time';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseRosterData() {
    let rawText = document.getElementById('rosterInput').value;
    
    // Normalize all line endings to \n
    let processedText = rawText.replace(/\r\n?/g, '\n');

    // Insert a space after the date if it is immediately followed by a letter (e.g., "2025SBY" -> "2025 SBY")
    processedText = processedText.replace(/(\d{2}\/\w{3}\/\d{2,4})([A-Za-z])/g, '$1 $2');
    
    // Ensure each date marker starts on a new line.
    processedText = processedText.replace(/(\d{2}\/\w{3}\/\d{2,4})/g, '\n$1');
    
    // Split into lines and filter out any empty lines that may have been created.
    let lines = processedText.trim().split('\n').filter(line => line.trim() !== '');
    
    // Allow optional leading whitespace before the date pattern on each line.
    const validLineRegex = /^\s*\d{2}\/\w{3}\/\d{2,4}[ \t]*/;
    const firstDataIndex = lines.findIndex(line => validLineRegex.test(line));

    if (firstDataIndex === -1) {
        return null;
    }
    lines = lines.slice(firstDataIndex);

    // Truncate the input data before the summary block
    const summaryStartIndex = lines.findIndex(line => 
        line.replace(/\s+/g, '').toLowerCase().startsWith('dutyhours')
    );
    if (summaryStartIndex !== -1) {
        lines = lines.slice(0, summaryStartIndex);
    }
    
    lines = cleanHeaderLines(lines);

    if (!lines.length || lines[0] === "") {
        return null;
    }
    
    // Correctly handle multiple entries on the same date by splitting them apart.
    const processedLines = [];
    lines.forEach(line => {
        if (validLineRegex.test(line) && processedLines.length > 0) {
            // Before starting a new entry, add a special marker to end the previous one.
            processedLines.push('---ENDOFLINEDELIMITER---');
        }
        processedLines.push(line);
    });
    
    const entriesText = processedLines.join('\n').split('---ENDOFLINEDELIMITER---');
    const rosterEntries = entriesText.map(entryText => {
        if (entryText.trim() === '') return null;
        return processRosterEntryBuffer(entryText.trim().split('\n'));
    }).filter(Boolean); // Filter out any null entries
    
    return rosterEntries;
}

function isAnnualLeave(entry) {
    const dutyTypeUpper = entry.dutyType.toUpperCase();
    return dutyTypeUpper.includes('LVE') || dutyTypeUpper.includes('ALV');
}

function isRDO(entry) {
     const dutyTypeUpper = entry.dutyType.toUpperCase();
       return dutyTypeUpper.includes('RDO') || dutyTypeUpper.includes('SDO');
}

/**
 * Checks if a given roster entry represents a day that is free of duty or is a leave day.
 * This is used for rules like Weekend Off, where leave days might count as "off".
 * @param {object} entry - The roster entry object.
 * @returns {boolean} True if the day is an RDO, Grey Day, Standby, or any type of leave.
 */
function isDayFreeOfDutyOrLeave(entry) {
    const dutyTypeUpper = entry.dutyType.toUpperCase();
    return isRDO(entry) ||
           dutyTypeUpper.includes('GREY') ||
           dutyTypeUpper.includes('SBY') ||
           isAnnualLeave(entry);
}

/**
 * Checks if a given roster entry represents an actual duty day (not RDO, Grey Day, Standby, or Leave).
 * @param {object} entry - The roster entry object.
 * @returns {boolean} True if the day is a duty day.
 */
function isDayOfDuty(entry) {
    return !isDayFreeOfDutyOrLeave(entry);
}

function checkForBreaches() {// --- Roster Type Check ---
    const pilotCheckRawText = document.getElementById('rosterInput').value.toUpperCase();
    if (pilotCheckRawText.includes('U/A') || pilotCheckRawText.includes('SBY-CC')) {
        alert("This appears to be a Cabin Crew roster. Please use the 'Check Cabin Crew Rules' button instead.");
        return; // Stop the function
    }
    gtag('event', 'button_click', { 'button_name': 'check_roster_rules' });
    const roster = parseRosterData();
    if (!roster) {
        document.getElementById('breachResults').style.display = 'none';
        return;
    }

    const breachList = document.getElementById('breachList');
    breachList.innerHTML = '';
    const flagsFound = [];    

    function addFlag(message, isInfo = false) {    
        flagsFound.push(message);
        const li = document.createElement('li');
        li.textContent = message;
        if (isInfo) {
            li.classList.add('info');
        }
        breachList.appendChild(li);
    }

    // RDO pro-rata table based on Annexure A, Table 1 (8 RDOs and 2 Grey day)
    const rdoProRataTable = {
        0: { rdo: 8, grey: 2 }, 1: { rdo: 8, grey: 2 }, 2: { rdo: 7, grey: 2 }, 3: { rdo: 7, grey: 2 },
        4: { rdo: 7, grey: 2 }, 5: { rdo: 7, grey: 2 }, 6: { rdo: 6, grey: 2 }, 7: { rdo: 6, grey: 2 },
        8: { rdo: 6, grey: 1 }, 9: { rdo: 5, grey: 1 }, 10: { rdo: 5, grey: 1 }, 11: { rdo: 5, grey: 1 },
        12: { rdo: 5, grey: 1 }, 13: { rdo: 4, grey: 1 }, 14: { rdo: 4, grey: 1 }, 15: { rdo: 4, grey: 1 },
        16: { rdo: 3, grey: 1 }, 17: { rdo: 3, grey: 1 }, 18: { rdo: 3, grey: 1 }, 19: { rdo: 3, grey: 1 },
        20: { rdo: 2, grey: 1 }, 21: { rdo: 2, grey: 1 }, 22: { rdo: 2, grey: 0 }, 23: { rdo: 1, grey: 0 },
        24: { rdo: 1, grey: 0 }, 25: { rdo: 1, grey: 0 }, 26: { rdo: 1, grey: 0 }, 27: { rdo: 0, grey: 0 },
        28: { rdo: 0, grey: 0 }
    };

    const earlyStartsThreshold = 3;

    // --- 1. Early Starts Deviation Check (CONSECUTIVE) ---
    let consecutiveEarlyStarts = 0;
    let currentConsecutiveBlockStartIdx = -1;
    for (let i = 0; i < roster.length; i++) {
        if (roster[i].isEarlyStart) {
            if (consecutiveEarlyStarts === 0) currentConsecutiveBlockStartIdx = i;
            consecutiveEarlyStarts++;
        } else {
            if (consecutiveEarlyStarts > earlyStartsThreshold) {
                addFlag(`Early Start Flag (Consecutive) [EA 14.8]: ${consecutiveEarlyStarts} consecutive duties before 06:00, started ${roster[currentConsecutiveBlockStartIdx].dateString}. (Usually max 3, unless agreed).`, true);
                for (let k = currentConsecutiveBlockStartIdx; k < i; k++) roster[k].consecutiveFlagged = true;
            }
            consecutiveEarlyStarts = 0;
        }
    }
    if (consecutiveEarlyStarts > earlyStartsThreshold) {
        addFlag(`Early Start Flag (Consecutive) [EA 14.8]: ${consecutiveEarlyStarts} consecutive duties before 06:00, started ${roster[currentConsecutiveBlockStartIdx].dateString}. (Usually max 3, unless agreed).`, true);
        for (let k = currentConsecutiveBlockStartIdx; k < roster.length; k++) roster[k].consecutiveFlagged = true;
    }

    // --- 2. Early Starts Deviation Check (ANY 7-DAY PERIOD) ---
    for (let i = 0; i < roster.length; i++) {
        const endDate = roster[i].date;
        const startDateWindow = new Date(endDate);
        startDateWindow.setDate(endDate.getDate() - 6);
        let earlyStartsInWindowCount = 0;
        let earlyStartDatesInWindow = [];
        for (let j = i; j >= 0 && roster[j].date >= startDateWindow; j--) {
            if (roster[j].isEarlyStart && !roster[j].consecutiveFlagged) {
                earlyStartsInWindowCount++;
                earlyStartDatesInWindow.unshift(roster[j].dateString);
            }
        }
        if (earlyStartsInWindowCount > earlyStartsThreshold) {
            addFlag(`Early Start Flag (7-Day) [EA 14.8]: ${earlyStartsInWindowCount} early starts in 7 days ending ${roster[i].dateString} (${earlyStartDatesInWindow.join(', ')}). (Usually max 3, unless agreed).`, true);
        }
    }

    // --- Minimum RDOs Check ---
    let approvedLeaveDays = 0;
    let actualRdoCount = 0;
    roster.forEach(entry => {
        if (isAnnualLeave(entry)) approvedLeaveDays++;
        else if (isRDO(entry)) actualRdoCount++;
    });
    const rosterDurationDays = Math.round((roster[roster.length - 1].date - roster[0].date) / (1000 * 60 * 60 * 24)) + 1;
    if (rosterDurationDays >= 27 && rosterDurationDays <= 29) {
        const leaveDaysIndex = Math.min(approvedLeaveDays, 28);
        const minRdoRequired = (rdoProRataTable[leaveDaysIndex] || rdoProRataTable[0]).rdo;
        if (actualRdoCount < minRdoRequired) {
            addFlag(`RDO Flag [EA 14.11]: Only ${actualRdoCount} RDOs in ${rosterDurationDays}-day period. Minimum ${minRdoRequired} required (adjusted for ${approvedLeaveDays} leave days).`);
        }
    }

    // --- One Weekend Off Check ---
    let hasWeekendOff = false;
    if (roster.length > 0) {
        for (let i = 0; i < roster.length - 1; i++) {
            const currentDay = roster[i];
            const nextDay = roster[i+1];
            if (currentDay.date.getDay() === 6 && nextDay.date.getDay() === 0) {
                if (isDayFreeOfDutyOrLeave(currentDay) && isDayFreeOfDutyOrLeave(nextDay)) {
                    hasWeekendOff = true;
                    break;
                }
            }
        }
        if (!hasWeekendOff && rosterDurationDays >= 27 && rosterDurationDays <= 29) {
            addFlag(`Weekend Off Flag [EA 14.16]: No full Sat/Sun RDO block found. (Unless mutually agreed, leave days count as off).`);
        }
    }

    // --- Consecutive Duty Tours Check ---
    const DUTY_TOUR_LENGTH = 6;
    let consecutiveDutyDays = 0;
    let dutyTourDetails = [];
    for (let i = 0; i < roster.length; i++) {
        if (roster[i].isActualDuty) {
            consecutiveDutyDays++;
        } else {
            if (consecutiveDutyDays >= DUTY_TOUR_LENGTH) {
                dutyTourDetails.push({ startIndex: i - consecutiveDutyDays });
            }
            consecutiveDutyDays = 0;
        }
    }
    if (consecutiveDutyDays >= DUTY_TOUR_LENGTH) {
        dutyTourDetails.push({ startIndex: roster.length - consecutiveDutyDays });
    }
    for (let i = 0; i < dutyTourDetails.length - 1; i++) {
        let daysOffBetween = 0;
        for (let j = dutyTourDetails[i].startIndex + DUTY_TOUR_LENGTH; j < dutyTourDetails[i + 1].startIndex; j++) {
            // Changed logic to count ANY non-duty day as a day off for this check.
            if (!isDayOfDuty(roster[j])) {
                daysOffBetween++;
            } else {
                break; 
            }
        }
        if (daysOffBetween < 2) {
            addFlag(`Duty Tour Flag [EA 14.15]: Two 6+ day tours are not separated by at least 2 consecutive days off. (Unless agreed).`);
        }
    }

    // --- Leave and Training Checks ---
    for (let i = 0; i < roster.length; i++) {
        if (isAnnualLeave(roster[i])) {
            let leaveBlockEndIndex = i;
            while (leaveBlockEndIndex + 1 < roster.length && isAnnualLeave(roster[leaveBlockEndIndex + 1])) {
                leaveBlockEndIndex++;
            }
            const leaveDuration = leaveBlockEndIndex - i + 1;

            // Sign-on/off Around Leave Check [EA 14.17] - With advanced logic for RDOs
            if (leaveDuration >= 7) {
                // Check Before Leave (and associated RDOs)
                let dutyBeforeIndex = i - 1;
                while(dutyBeforeIndex >= 0) {
                    const precedingEntry = roster[dutyBeforeIndex];
                    if (isDayOfDuty(precedingEntry)) {
                        if (!isNaN(parseTime(precedingEntry.debriefTime)) && parseTime(precedingEntry.debriefTime) > parseTime('14:00')) {
                             addFlag(`Leave Buffer Flag [EA 14.17]: Sign-off on ${precedingEntry.dateString} (${precedingEntry.debriefTime}) is after 14:00 before an RDO/Leave block. (Unless agreed).`);
                        }
                        break;
                    } else if (isRDO(precedingEntry)) {
                        dutyBeforeIndex--; // It's an RDO, keep looking backwards
                    } else {
                        break; // It's something else (SBY, etc.), so stop searching
                    }
                }
                
                // Check After Leave (and associated RDOs)
                let dutyAfterIndex = leaveBlockEndIndex + 1;
                while(dutyAfterIndex < roster.length) {
                     const subsequentEntry = roster[dutyAfterIndex];
                       if (isDayOfDuty(subsequentEntry)) {
                             if (!isNaN(parseTime(subsequentEntry.briefTime)) && parseTime(subsequentEntry.briefTime) < parseTime('12:00')) {
                                   addFlag(`Leave Buffer Flag [EA 14.17]: Sign-on on ${subsequentEntry.dateString} (${subsequentEntry.briefTime}) is before 12:00 after an RDO/Leave block. (Unless agreed).`);
                             }
                             break;
                       } else if (isRDO(subsequentEntry)) {
                             dutyAfterIndex++; // It's an RDO, keep looking forwards
                       } else {
                             break; // It's something else, stop searching
                       }
                }
            }

            // Training After Leave Check [EA 14.47]
            if (leaveDuration > 14) {
                for (let j = leaveBlockEndIndex + 1; j < leaveBlockEndIndex + 11 && j < roster.length; j++) {
                     if (roster[j].dutyType.toUpperCase().includes('TRG')) {
                          addFlag(`Training After Leave Flag [EA 14.47]: Training on ${roster[j].dateString} is within 10 days of returning from a ${leaveDuration}-day leave block.`);
                          break;
                     }
                }
            }
            i = leaveBlockEndIndex;
        }
    }

    // --- Maximum Nights Away Check [EA 14.54] ---
    let consecutiveNightsAway = 0;
    let longTripCount = 0;
    for (let i = 0; i < roster.length; i++) {
        if (roster[i].layover.trim() !== '') {
            consecutiveNightsAway++;
        } else {
            if (consecutiveNightsAway > 5) longTripCount++;
            consecutiveNightsAway = 0;
        }
    }
    if (consecutiveNightsAway > 5) longTripCount++;
    if (longTripCount > 1) { // Only flag if more than one such trip occurs
         addFlag(`Nights Away Flag [EA 14.54]: Found ${longTripCount} trips of more than 5 consecutive nights. (Max 1 per roster period is allowed).`);
    } else if (longTripCount > 0) {
         addFlag(`Info: A trip longer than 5 nights was found. (Max 1 per roster period is allowed under EA 14.54).`, true);
    }
    
    // --- Rest Periods & Standby Checks ---
    const HOME_BASE_MIN_REST_MINUTES = 12 * 60;
    for (let i = 0; i < roster.length - 1; i++) {
        const prevEntry = roster[i];
        const currentEntry = roster[i + 1];

        // Rest Before Standby Check [EA 14.50]
        if (currentEntry.dutyType.toUpperCase().startsWith('SBY') && prevEntry.isActualDuty) {
            const prevDebriefTime = parseTime(prevEntry.debriefTime);
            
            // Regex to find the first time string (the start time) in the details
            const standbyTimeMatch = currentEntry.details.match(/(\d{2}:\d{2})/);

            if (!isNaN(prevDebriefTime) && standbyTimeMatch) {
                const standbyStartTimeStr = standbyTimeMatch[1];
                const standbyStartTime = parseTime(standbyStartTimeStr);

                // Create full Date objects for accurate difference calculation
                const prevDebriefDate = new Date(prevEntry.date);
                prevDebriefDate.setHours(Math.floor(prevDebriefTime / 60), prevDebriefTime % 60, 0, 0);

                const standbyStartDate = new Date(currentEntry.date);
                standbyStartDate.setHours(Math.floor(standbyStartTime / 60), standbyStartTime % 60, 0, 0);

                const restInMinutes = Math.round((standbyStartDate - prevDebriefDate) / (1000 * 60));

                if (restInMinutes < HOME_BASE_MIN_REST_MINUTES) {
                    addFlag(`Rest Before Standby Flag [EA 14.50]: Only ${formatMinutesToHHMM(restInMinutes)} rest between duty on ${prevEntry.dateString} and Standby on ${currentEntry.dateString}. (Min 12 hrs req'd).`);
                }
            }
        }
        
        // General Rest Periods Check [EA 14.48]
        if (prevEntry.isActualDuty && currentEntry.isActualDuty && !isNaN(parseTime(prevEntry.debriefTime)) && !isNaN(parseTime(currentEntry.briefTime))) {
            const prevDebriefDate = new Date(prevEntry.date);
            prevDebriefDate.setHours(Math.floor(parseTime(prevEntry.debriefTime) / 60), parseTime(prevEntry.debriefTime) % 60, 0, 0);
            const currentBriefDate = new Date(currentEntry.date);
            currentBriefDate.setHours(Math.floor(parseTime(currentEntry.briefTime) / 60), parseTime(currentEntry.briefTime) % 60, 0, 0);
            const restDurationMinutes = Math.round((currentBriefDate - prevDebriefDate) / (1000 * 60));

            if (restDurationMinutes < HOME_BASE_MIN_REST_MINUTES) {
                const isAtHomeBase = prevEntry.layover.trim() === '';
                if (isAtHomeBase) {
                    addFlag(`Home Base Rest Flag [EA 14.48]: Only ${formatMinutesToHHMM(restDurationMinutes)} rest between duties on ${prevEntry.dateString} and ${currentEntry.dateString}. (Min 12 hrs req'd).`);
                } else {
                    addFlag(`Info: Short Rest [EA 14.48]: Only ${formatMinutesToHHMM(restDurationMinutes)} rest between duties on ${prevEntry.dateString} and ${currentEntry.dateString}. (May be permissible if away from Home Base or under FRMS).`, true);
                }
            }
        }
    }


    // Display overall result
    if (flagsFound.length === 0) {
        const li = document.createElement('li');
        li.textContent = "No roster flags identified based on current checks. (Beta Mode guidance only).";
        li.classList.add('no-breach');
        breachList.appendChild(li);
    }

    document.getElementById('breachResults').style.display = 'block';
}

// --- START: CABIN CREW IMPLANT ---
function checkForCabinCrewBreaches() {// --- Roster Type Check ---
    const ccCheckRawText = document.getElementById('rosterInput').value.toUpperCase();
    if (ccCheckRawText.includes('GREY') || ccCheckRawText.includes('SBY-FC')) {
        alert("This appears to be a Pilot roster. Please use the 'Check Pilot Rules' button instead.");
        return; // Stop the function
    }
    gtag('event', 'button_click', { 'button_name': 'check_cabin_crew_rules' });
    const roster = parseRosterData();
    if (!roster) {
        document.getElementById('breachResults').style.display = 'none';
        return;
    }

    const breachList = document.getElementById('breachList');
    breachList.innerHTML = ''; // Clear previous results
    const flagsFound = [];

    function addFlag(message, isInfo = false) {
        flagsFound.push(message);
        const li = document.createElement('li');
        li.textContent = message;
        if (isInfo) {
            li.classList.add('info');
        }
        breachList.appendChild(li);
    }

    // --- 1. Max Consecutive Duty Days Check ---
    let consecutiveDutyDays = 0;
    for (const entry of roster) {
        if (isDayOfDuty(entry)) {
            consecutiveDutyDays++;
        } else {
            consecutiveDutyDays = 0;
        }
        if (consecutiveDutyDays > 6) {
            addFlag(`Consecutive Duty Flag [EA 24.2(c)]: More than 6 consecutive duty days found, ending on ${entry.dateString}.`);
            consecutiveDutyDays = 0; // Reset after flagging to avoid multiple flags for the same block
        }
    }

    // --- 2. RDO & U/A Day Counts for 28-Day Roster ---
    const rosterDurationDays = Math.round((roster[roster.length - 1].date - roster[0].date) / (1000 * 60 * 60 * 24)) + 1;
    if (rosterDurationDays >= 27 && rosterDurationDays <= 29) {
        const rdoCount = roster.filter(e => isRDO(e)).length;
        const uaCount = roster.filter(e => e.dutyType.toUpperCase().includes('U/A')).length;

        if (rdoCount < 8) {
            addFlag(`RDO Count Flag [EA 24.3(a)]: Found ${rdoCount} RDOs. A 28-day roster requires a minimum of 8.`);
        }
       if (uaCount !== 4) {
    addFlag(`Unassigned Day Flag [EA 24.2(b)]: Found ${uaCount} U/A days. A 28-day roster requires exactly 4. (Note: A lower count may occur if U/A days were assigned prior to roster publication).`, true);
}
    }

    // --- 3. RDO Buffer Checks ---
    for (let i = 0; i < roster.length; i++) {
        if (isRDO(roster[i])) {
            // Find the start and end of the RDO block
            let rdoBlockStartIndex = i;
            let rdoBlockEndIndex = i;
            while (rdoBlockEndIndex + 1 < roster.length && isRDO(roster[rdoBlockEndIndex + 1])) {
                rdoBlockEndIndex++;
            }

            const isSingleRDO = (rdoBlockStartIndex === rdoBlockEndIndex);
            const precedingDuty = roster[rdoBlockStartIndex - 1];
            const subsequentDuty = roster[rdoBlockEndIndex + 1];

            if (precedingDuty && subsequentDuty && isDayOfDuty(precedingDuty) && isDayOfDuty(subsequentDuty)) {
                const debriefTime = parseTime(precedingDuty.debriefTime);
                const briefTime = parseTime(subsequentDuty.briefTime);

                if (!isNaN(debriefTime) && debriefTime > parseTime("22:00")) {
                     addFlag(`RDO Buffer Flag [EA 24.3]: Duty on ${precedingDuty.dateString} finishes after 22:00 before an RDO block.`);
                }
                
                if (!isNaN(briefTime)) {
                    if (isSingleRDO && briefTime < parseTime("06:00")) {
                         addFlag(`RDO Buffer Flag [EA 24.3(c)]: Duty on ${subsequentDuty.dateString} starts before 06:00 after a single RDO.`);
                    } else if (!isSingleRDO && briefTime < parseTime("05:00")) {
                         addFlag(`RDO Buffer Flag [EA 24.3(d)]: Duty on ${subsequentDuty.dateString} starts before 05:00 after a multiple RDO block.`);
                    }
                }
            }
            i = rdoBlockEndIndex; // Skip to the end of the processed RDO block
        }
    }
    
    // --- 4. Minimum Rest Checks ---
    const HOME_BASE_REST_MINS = 11 * 60;
    const BEFORE_RESERVE_REST_MINS = 10 * 60;
    for (let i = 0; i < roster.length - 1; i++) {
        const prevEntry = roster[i];
        const currentEntry = roster[i + 1];

        if (isDayOfDuty(prevEntry)) {
            const prevDebriefTime = parseTime(prevEntry.debriefTime);
            if (isNaN(prevDebriefTime)) continue;

            const prevDebriefDate = new Date(prevEntry.date);
            prevDebriefDate.setHours(Math.floor(prevDebriefTime / 60), prevDebriefTime % 60);

            // Home Base Rest Check
            if (isDayOfDuty(currentEntry) && prevEntry.layover.trim() === '') {
                const currentBriefTime = parseTime(currentEntry.briefTime);
                if (isNaN(currentBriefTime)) continue;

                const currentBriefDate = new Date(currentEntry.date);
                currentBriefDate.setHours(Math.floor(currentBriefTime / 60), currentBriefTime % 60);
                
                const restInMinutes = (currentBriefDate - prevDebriefDate) / (1000 * 60);

                if (restInMinutes < HOME_BASE_REST_MINS) {
                    addFlag(`Home Base Rest Flag [EA 24.4(a)]: Only ${formatMinutesToHHMM(restInMinutes)} rest between duties on ${prevEntry.dateString} and ${currentEntry.dateString}. (Min 11 hrs req'd).`, true);
                }
            }

// Rest Before Reserve Check [EA 24.4(b)]
if (currentEntry.dutyType.toUpperCase().includes('SBY') || currentEntry.dutyType.toUpperCase().includes('RESERVE')) {
    // Find the actual start time of the reserve/standby from the details string.
    const reserveTimeMatch = currentEntry.details.match(/(\d{2}:\d{2})/);
    
    if (reserveTimeMatch) {
        const reserveStartTime = parseTime(reserveTimeMatch[1]);
        const reserveStartDate = new Date(currentEntry.date);
        reserveStartDate.setHours(Math.floor(reserveStartTime / 60), reserveStartTime % 60);

        // --- START OF SURGICAL FIX ---
        // Safeguard: Skip check if the previous duty ends after or at the same time the reserve starts.
        // This handles same-day duties that are not in chronological order.
        if (prevDebriefDate >= reserveStartDate) continue; 
        // --- END OF SURGICAL FIX ---

        const restInMinutes = (reserveStartDate - prevDebriefDate) / (1000 * 60);

        if (restInMinutes < BEFORE_RESERVE_REST_MINS) {
            addFlag(`Rest Before Reserve Flag [EA 24.4(b)]: Only ${formatMinutesToHHMM(restInMinutes)} rest before reserve on ${currentEntry.dateString}. (Min 10 hrs req'd).`);
        }
    }
}
        }
    }

// --- 5. Reserve Duration Checks ---
    roster.forEach(entry => {
        const dutyTypeUpper = entry.dutyType.toUpperCase();
        
        // This check now recognizes both RESERVE and SBY duty types.
        if (dutyTypeUpper.includes('RESERVE') || dutyTypeUpper.includes('SBY')) {
            
            let standbyDurationMinutes = 0;
            // Regex to find two HH:MM times separated by "L/" in the details string.
            const timeMatch = entry.details.match(/(\d{2}:\d{2})L\/\s*(\d{2}:\d{2})L/);

            // If a match is found, calculate the duration in minutes.
            if (timeMatch && timeMatch.length === 3) {
                const startTime = parseTime(timeMatch[1]);
                const endTime = parseTime(timeMatch[2]);
                if (!isNaN(startTime) && !isNaN(endTime)) {
                    standbyDurationMinutes = endTime - startTime;
                }
            } else {
                // Fallback to dutyHours if details parsing fails, though it may be inaccurate.
                standbyDurationMinutes = parseTime(entry.dutyHours);
            }

            // Check if it's an Airport Standby (contains SBYAPT or AIRPORT).
            if (dutyTypeUpper.includes('AIRPORT') || dutyTypeUpper.includes('SBYAPT')) {
                // Check if the calculated duration exceeds the 4-hour limit (240 minutes).
                if (standbyDurationMinutes > 240) {
                     addFlag(`Airport Reserve Flag [EA 24.6(a)]: Airport Reserve on ${entry.dateString} exceeds 4 hours.`);
                }
            } else {
                 // Otherwise, it's a Home Standby. Check against the 12-hour limit (720 minutes).
                 if (standbyDurationMinutes > 720) {
                     addFlag(`Reserve Duty Flag [EA 24.5(a)(ii)]: Reserve on ${entry.dateString} exceeds 12 hours.`);
                 }
            }
        }
    });

    // --- 6. Leave Related Checks ---
    for (let i = 0; i < roster.length; i++) {
        if (isAnnualLeave(roster[i])) {
            // No U/A after Leave
            if (i + 1 < roster.length && roster[i + 1].dutyType.toUpperCase().includes('U/A')) {
                addFlag(`Leave/UA Flag [EA 24.7(a)]: Unassigned Day found on ${roster[i+1].dateString} immediately following Annual Leave.`);
            }

            // No Training within 7 days of returning from leave
            let leaveBlockEndIndex = i;
            while(leaveBlockEndIndex + 1 < roster.length && isAnnualLeave(roster[leaveBlockEndIndex + 1])) {
                leaveBlockEndIndex++;
            }

            for (let j = leaveBlockEndIndex + 1; j < leaveBlockEndIndex + 8 && j < roster.length; j++) {
                if (roster[j].dutyType.toUpperCase().includes('TRG') || roster[j].dutyType.toUpperCase().includes('CHECK')) {
                    addFlag(`Training After Leave Flag [EA 25.3(g)]: Training/Checking on ${roster[j].dateString} is within 7 days of returning from leave.`);
                    break;
                }
            }
            i = leaveBlockEndIndex;
        }
    }

// --- 7. Rolling 14-Day Applicable Duty Check ---
    const NINETY_HOURS_IN_MINUTES = 90 * 60;
    // Iterate through each day of the roster to use it as an end-point for a 14-day window.
    for (let i = 0; i < roster.length; i++) {
        const windowEndDate = roster[i].date;
        const windowStartDate = new Date(windowEndDate);
        windowStartDate.setDate(windowEndDate.getDate() - 13); // Creates a 14-day window

        let applicableMinutesInWindow = 0;

        // Loop backwards from the current day to sum up hours within the 14-day window.
        for (let j = i; j >= 0 && roster[j].date >= windowStartDate; j--) {
            const entryInWindow = roster[j];
            const dutyTypeUpper = entryInWindow.dutyType.toUpperCase();

            // Use the corrected logic to sum 'Applicable Duty' hours.
            if (isDayOfDuty(entryInWindow) || dutyTypeUpper.includes('SBYAPT')) {
                applicableMinutesInWindow += parseTime(entryInWindow.dutyHours);
            }
        }

        // If the total in the window exceeds 90 hours, create a flag.
        if (applicableMinutesInWindow > NINETY_HOURS_IN_MINUTES) {
            const totalHoursInWindow = formatMinutesToHHMM(applicableMinutesInWindow);
            addFlag(`Applicable Duty Flag [EA 24.1]: Exceeded 90 hours in the 14-day period ending ${roster[i].dateString}. Total: ${totalHoursInWindow}.`);
        }
    }

    // --- FINAL: Display Results ---
    if (flagsFound.length === 0) {
        const li = document.createElement('li');
        li.textContent = "No cabin crew roster flags identified based on the implemented checks.";
        li.classList.add('no-breach');
        breachList.appendChild(li);
    }
    document.getElementById('breachResults').style.display = 'block';
}
// --- END: CABIN CREW IMPLANT ---


// Functions for the modals
function showBreachInfoModal() {
    breachInfoModal.style.display = 'flex';    
}

function hideBreachInfoModal() {
    breachInfoModal.style.display = 'none';
}

function showAboutInfoModal() { // New function for About modal
    aboutInfoModal.style.display = 'flex';
}

function hideAboutInfoModal() { // New function for About modal
    aboutInfoModal.style.display = 'none';
}

// --- START: CABIN CREW IMPLANT ---
// Functions for the Cabin Crew modal
function showCabinCrewInfoModal() {
    cabinCrewInfoModal.style.display = 'flex';
}

function hideCabinCrewInfoModal() {
    cabinCrewInfoModal.style.display = 'none';
}
// --- END: CABIN CREW IMPLANT ---

// New function for the dummy upload button
function showComingSoon() {
    alert("PDF and file upload functionality is coming soon!");
}

function loadDemoRoster() {
    const demoRoster = `23/Jun/2025	MVO	10:15	19:35	ROK	
QF1896 BNE / ISA/- 11:22L/ 14:00L
QF1895 ISA / BNE/- 14:37L/ 16:55L
QF1994 BNE / ROK/- 17:59L/ 19:20L
The Edge Apartment Hotel
9:20	9:20	6:17	-	6:17
24/Jun/2025	MVO	07:55	16:05		
QF1871 ROK / BNE/- 08:40L/ 09:50L
QF1898 BNE / HTI/- 11:51L/ 13:37L
QF1899 HTI / BNE/- 14:13L/ 15:50L
8:10	8:10	3:23	1:10	3:23
25/Jun/2025	SBY-FC				
BNE / BNE/- 04:30L/ 16:30L
26/Jun/2025	FLY	04:05	10:57		
QF1892 BNE / ISA/- 05:02L/ 07:54L
QF1891 ISA / BNE/- 08:33L/ 10:42L
6:52	6:52	5:01	-	5:01
27/Jun/2025	GREY				
BNE / BNE/- 00:00L/ 23:59L
28/Jun/2025	RDO				
BNE / BNE/- 00:00L/ 23:59L
29/Jun/2025	RDO				
BNE / BNE/- 00:00L/ 23:59L
30/Jun/2025	FLY	04:00	20:14		
QF357 BNE / HIR/- 11:58L/ 16:19L
QF358 HIR / BNE/- 17:35L/ 19:44L
10:14	9:59	6:30	-	6:30
01/Jul/2025	MVO	04:00	20:49	NTL	
QF1965 BNE / NTL/- 14:04L/ 15:26L
QF1966 NTL / BNE/- 16:11L/ 17:26L
QF1967 BNE / NTL/- 19:13L/ 20:34L
Mercure Newcastle
7:49	7:49	3:58	-	3:58
02/Jul/2025	FLY	04:05	20:28	NTL	
QF1966 NTL / BNE/- 15:58L/ 17:11L
QF1967 BNE / NTL/- 18:47L/ 20:13L
Mercure Newcastle
5:23	5:23	2:39	-	2:39
03/Jul/2025	MVO	04:05	11:44		
QF1964 NTL / BNE/- 10:09L/ 11:29L
2:39	2:39	1:20	-	1:20
04/Jul/2025	RDO				
BNE / BNE/- 00:00L/ 23:59L
05/Jul/2025	RDO				
BNE / BNE/- 00:00L/ 23:59L
06/Jul/2025	FLY	16:40	22:18		
QF1868 BNE / TSV/- 17:33L/ 19:40L
QF1869 TSV / BNE/- 20:17L/ 22:03L
5:38	5:38	3:53	-	3:53
07/Jul/2025	FLY	16:05	20:42		
QF1948 BNE / EMD/- 17:07L/ 18:29L
QF1949 EMD / BNE/- 19:00L/ 20:27L
4:37	4:37	2:49	-	2:49
08/Jul/2025	RDO				
BNE / BNE/- 00:00L/ 23:59L
09/Jul/2025	RDO				
BNE / BNE/- 00:00L/ 23:59L
10/Jul/2025	MVP	09:10	13:35	DRW	
VA447DHD BNE / DRW/- 09:55L/ 13:20L
Oaks Darwin Elan Hotel
4:55	-	-	3:55	-
11/Jul/2025	FLY	04:45	13:25	DRW	
QQ4801 DRW / GTS/- 05:52L/ 07:27L
QQ4811 GTS / ASP/- 08:06L/ 08:58L
QQ4812 ASP / GTS/- 09:43L/ 10:51L
QQ4804 GTS / DRW/- 11:34L/ 13:10L
Oaks Darwin Elan Hotel
8:40	8:40	5:11	-	5:11
12/Jul/2025	FLY	05:00	11:12	DRW	
QF1958 DRW / ASP/- 05:58L/ 08:01L
QF1959 ASP / DRW/- 08:58L/ 10:57L
Oaks Darwin Elan Hotel
6:12	6:12	4:02	-	4:02
13/Jul/2025	FLY	05:15	12:11	DRW	
QF1889 DRW / CNS/- 06:12L/ 09:09L
QF1888 CNS / DRW/- 09:56L/ 11:56L
Oaks Darwin Elan Hotel
6:56	6:56	4:57	-	4:57
14/Jul/2025	MVP	11:40	17:25		
QF825DHD DRW / BNE/- 12:25L/ 17:10L
5:15	-	-	4:15	-
15/Jul/2025	FLY	06:05	15:39		
QF1876 BNE / ROK/- 07:01L/ 08:22L
QF1877 ROK / BNE/- 09:13L/ 10:24L
QF1994 BNE / PPP/- 11:12L/ 12:51L
QF1995 PPP / BNE/- 13:46L/ 15:24L
9:34	9:34	5:49	-	5:49
16/Jul/2025	RDO				
BNE / BNE/- 00:00L/ 23:59L
17/Jul/2025	RDO				
BNE / BNE/- 00:00L/ 23:59L
18/Jul/2025	FLY	09:25	14:35		
QF1802 BNE / MKY/- 10:25L/ 12:05L
QF1803 MKY / BNE/- 12:55L/ 14:20L
5:10	5:10	3:05	-	3:05
19/Jul/2025	MVO	07:25	15:40	NTL	
QF1903 BNE / CBR/- 08:25L/ 10:15L
QF1906 CBR / BNE/- 10:55L/ 12:40L
QF1965 BNE / NTL/- 14:00L/ 15:25L
Mercure Newcastle
8:15	8:15	5:00	-	5:00
20/Jul/2025	FLY	15:05	20:35	NTL	
QF1966 NTL / BNE/- 16:05L/ 17:25L
QF1967 BNE / NTL/- 18:55L/ 20:20L
Mercure Newcastle
5:30	5:30	2:45	-	2:45`;
    document.getElementById('rosterInput').value = demoRoster;
}

function generatePrintout() {
    gtag('event', 'button_click', { 'button_name': 'print_roster' });
    const rosterEntries = parseRosterData();
    if (!rosterEntries || rosterEntries.length === 0) {
        return alert("Paste your roster first or check its format.");
    }

    const tbody = document.getElementById('printTableBody');
    const table = document.getElementById('printTable');
    tbody.innerHTML = '';

    // --- Initialize layover count ---
    let layoverCount = 0;
    let totals = [0, 0, 0, 0, 0]; 

    function parseMinutes(time) {
        if (!time || !time.includes(':') || time === '-') return 0;
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    }

    function formatMinutes(mins) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return `${h}:${m.toString().padStart(2, '0')}`;
    }

    rosterEntries.forEach(entry => {
        const d = entry.date;
        const dayOfWeek = d.toLocaleDateString('en-AU', { weekday: 'short' });
        const fullDay = d.toLocaleDateString('en-AU', { weekday: 'long' });
        const isWeekend = (fullDay === 'Saturday' || fullDay === 'Sunday');

        const tr = document.createElement('tr');
        if (isWeekend) tr.classList.add('weekend-row');

        // --- Increment layover count if a layover exists ---
        if (entry.layover && entry.layover.trim() !== '') {
            layoverCount++;
        }
        
        const rowPrintData = [
            `${dayOfWeek} ${entry.dateString}`, entry.dutyType, entry.briefTime, entry.debriefTime,
            entry.layover, entry.details, entry.dutyHours, entry.flightDutyPeriod, entry.flightHours, entry.paxHours, entry.creditHours
        ];

        rowPrintData.forEach(val => {
            const td = document.createElement('td');
            td.textContent = val;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);

        totals[0] += parseMinutes(entry.dutyHours);
        totals[1] += parseMinutes(entry.flightDutyPeriod); 
        totals[2] += parseMinutes(entry.flightHours); 
        totals[3] += parseMinutes(entry.paxHours);
        totals[4] += parseMinutes(entry.creditHours);
    });

    // --- The repeating header row code has been REMOVED from here. ---

    const summaryRow = document.createElement('tr');
    for (let i = 0; i < 11; i++) {
        const td = document.createElement('td');
        if (i === 0) td.textContent = 'TOTAL';
        // --- Add the layover count to the correct cell ---
        if (i === 4) td.textContent = layoverCount;
        if (i >= 6) td.textContent = formatMinutes(totals[i - 6]);
        summaryRow.appendChild(td);
    }
    summaryRow.style.fontWeight = 'bold';
    summaryRow.style.borderTop = '2px solid #000';
    tbody.appendChild(summaryRow);

    table.style.display = 'table';
    window.print();
}