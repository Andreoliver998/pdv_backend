package com.pdv.app.network

import com.pdv.app.Config
import com.pdv.app.auth.AuthApi
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object NetworkModule {

    // Se for EMULADOR Android, use 10.0.2.2
    // Se for CELULAR FÍSICO na mesma rede, use o IP da sua máquina (ex: 192.168.0.10)

    private val logging = HttpLoggingInterceptor().apply {
        level = HttpLoggingInterceptor.Level.BODY
    }

    private val httpClient = OkHttpClient.Builder()
        .addInterceptor(logging)
        .build()

    private val retrofit: Retrofit = Retrofit.Builder()
        .baseUrl(Config.API_BASE_URL)
        .client(httpClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()

    val authApi: AuthApi = retrofit.create(AuthApi::class.java)
}
