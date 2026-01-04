package com.pdv.app

import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.pdv.app.auth.LoginRequest
import com.pdv.app.network.NetworkModule
import com.pdv.app.session.SessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private lateinit var etEmail: EditText
    private lateinit var etPassword: EditText
    private lateinit var btnLogin: Button
    private lateinit var progress: ProgressBar
    private lateinit var sessionManager: SessionManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        sessionManager = SessionManager(this)

        etEmail = findViewById(R.id.etEmail)
        etPassword = findViewById(R.id.etPassword)
        btnLogin = findViewById(R.id.btnLogin)
        progress = findViewById(R.id.progress)

        // Pré-preencher com o usuário padrão para testar
        etEmail.setText("andre@example.com")
        etPassword.setText("123456")

        btnLogin.setOnClickListener { doLogin() }
    }

    private fun doLogin() {
        val email = etEmail.text.toString().trim()
        val password = etPassword.text.toString().trim()

        if (email.isEmpty() || password.isEmpty()) {
            Toast.makeText(this, "Preencha e-mail e senha", Toast.LENGTH_SHORT).show()
            return
        }

        progress.visibility = View.VISIBLE
        btnLogin.isEnabled = false

        lifecycleScope.launch {
            try {
                val body = LoginRequest(email = email, password = password)

                val response = withContext(Dispatchers.IO) {
                    NetworkModule.authApi.login(body)
                }

                progress.visibility = View.GONE
                btnLogin.isEnabled = true

                if (response.isSuccessful && response.body() != null) {
                    val loginResponse = response.body()!!

                    // Se token for nullable, trate aqui:
                    sessionManager.saveToken(loginResponse.token)

                    Toast.makeText(
                        this@MainActivity,
                        "Bem-vindo, ${loginResponse.user.name}",
                        Toast.LENGTH_LONG
                    ).show()

                    // Próximo passo:
                    // startActivity(Intent(this@MainActivity, HomeActivity::class.java))
                    // finish()

                } else {
                    Toast.makeText(
                        this@MainActivity,
                        "Login inválido (${response.code()})",
                        Toast.LENGTH_LONG
                    ).show()
                }

            } catch (e: Exception) {
                progress.visibility = View.GONE
                btnLogin.isEnabled = true

                Toast.makeText(
                    this@MainActivity,
                    "Erro ao conectar no servidor: ${e.message}",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }
}
