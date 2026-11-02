package com.example.gmwdt

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import java.io.File
import java.io.FileOutputStream

class FileSaver(private val context: Context) {

    fun save(base64: String, fileName: String, mimeType: String): Result<String> = runCatching {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveViaMediaStore(bytes, fileName, mimeType)
        } else {
            saveViaFile(bytes, fileName)
        }
    }

    private fun saveViaMediaStore(bytes: ByteArray, fileName: String, mimeType: String): String {
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
        }
        val uri = context.contentResolver.insert(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI, values
        ) ?: error("MediaStore вернул null")

        context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
            ?: error("Не удалось открыть поток")

        return "Downloads/$fileName"
    }

    private fun saveViaFile(bytes: ByteArray, fileName: String): String {
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        if (!dir.exists()) dir.mkdirs()
        val file = File(dir, fileName)
        FileOutputStream(file).use { it.write(bytes) }
        return file.absolutePath
    }
}