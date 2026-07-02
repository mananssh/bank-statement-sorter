import "server-only";
import * as XLSX from "xlsx";
import type { Grid } from "@/lib/parsers/types";
import { isEncryptedWorkbook, decryptWorkbook } from "@/lib/parsers/decrypt";

export interface OpenedWorkbook {
  sheetNames: string[];
  grid(sheetName: string): Grid;
}

export class WorkbookPasswordRequiredError extends Error {
  constructor() {
    super("Workbook is password-protected");
    this.name = "WorkbookPasswordRequiredError";
  }
}

/**
 * Open any supported statement file (.xlsx, legacy BIFF .xls, .csv) into a
 * uniform grid API. Password-protected workbooks are decrypted in memory when
 * a password is supplied, otherwise WorkbookPasswordRequiredError is thrown.
 */
export async function openWorkbook(buffer: Buffer, password?: string): Promise<OpenedWorkbook> {
  let data = buffer;
  if (isEncryptedWorkbook(buffer)) {
    if (!password) throw new WorkbookPasswordRequiredError();
    data = await decryptWorkbook(buffer, password);
  }

  // cellDates:false keeps date cells as raw serial numbers, which our date
  // coercion handles uniformly with text dates.
  const wb = XLSX.read(data, { type: "buffer", cellDates: false });

  return {
    sheetNames: wb.SheetNames,
    grid(sheetName: string): Grid {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) return [];
      return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: true,
        defval: null,
        blankrows: true,
      });
    },
  };
}
