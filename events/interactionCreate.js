const { Events, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');

// Definição dos canais e categorias oficiais enviados por você
const ID_CANAL_RESULTADOS = "1529134537018441738"; 
//const ID_CATEGORIA_TICKETS = "1565178591820386314";
const CAMINHO_CONTADOR = path.join(__dirname, '../contador.txt');

// Banco temporário em memória para salvar as etapas de fechamento de cada canal
const memoriaFechamento = new Map();

// Função auxiliar segura para ler e atualizar o número do protocolo incremental
function obterProximoCaso() {
    try {
        if (!fs.existsSync(CAMINHO_CONTADOR)) {
            fs.writeFileSync(CAMINHO_CONTADOR, '1', 'utf8');
            return 1;
        }
        const dados = fs.readFileSync(CAMINHO_CONTADOR, 'utf8').trim();
        const numeroAtual = parseInt(dados, 10) || 0;
        const proximoNumero = numeroAtual + 1;
        fs.writeFileSync(CAMINHO_CONTADOR, proximoNumero.toString(), 'utf8');
        return proximoNumero;
    } catch (error) {
        console.error("Erro ao manipular arquivo de contador:", error);
        return Math.floor(Math.random() * 9000) + 1000;
    }
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {

        // --- 1. COMANDOS DE BARRA (/) ---
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                await interaction.reply({ content: 'Houve um erro ao executar esse comando!', ephemeral: true });
            }
        }

        // --- 2. INTERAÇÃO COM BOTÕES ---
        if (interaction.isButton()) {
            const { guild, user, customId, channelId } = interaction;
            
            // BOTÃO: Iniciar o processo de fechamento do chamado
            if (customId === 'btn_fechar_ticket') {
                const temAcesso = config.idCargoCorregedor.some(id => interaction.member.roles.cache.has(id)) || 
                                  config.idCargoStaff.some(id => interaction.member.roles.cache.has(id)) || 
                                  interaction.member.permissions.has(PermissionFlagsBits.Administrator);

                if (!temAcesso) {
                    return interaction.reply({ content: "❌ Apenas membros da Corregedoria ou Staff podem definir o veredicto deste caso.", ephemeral: true });
                }

                // Se for um ticket de revogação e o usuário já selecionou a punição no início, usamos esses dados pré-salvos
                const dadosExistentes = memoriaFechamento.get(channelId);
                if (dadosExistentes && dadosExistentes.isRevogacao) {
                    // Pula a seleção de múltiplos membros (já que o alvo é o próprio criador do ticket)
                    const embedEscolha = new EmbedBuilder()
                        .setTitle("⚖️ ESCOLHA O VEREDICTO DA REVOGAÇÃO")
                        .setDescription(`Usuário solicitante: <@${dadosExistentes.envolvidos[0]}>\nCargo para revisar: <@&${dadosExistentes.cargoParaRemover}>\n\nEscolha o desfecho deste pedido de revisão:`)
                        .setColor(0x2f3136);

                    const rowEscolhas = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('btn_final_deferido').setLabel('✅ Deferido (Retirar Punição)').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('btn_final_indeferido').setLabel('❌ Indeferido (Manter Punição)').setStyle(ButtonStyle.Danger)
                    );

                    return interaction.reply({ embeds: [embedEscolha], components: [rowEscolhas] });
                }

                const embedFiltro = new EmbedBuilder()
                    .setTitle("👤 SELEÇÃO DE ENVOLVIDOS")
                    .setDescription("Selecione abaixo o(s) usuário(s) que receberá(ão) o veredicto deste caso. Você pode marcar mais de um se necessário:")
                    .setColor(0x2f3136);

                const menuUsuarios = new UserSelectMenuBuilder()
                    .setCustomId('selecao_membros_caso')
                    .setPlaceholder('Clique aqui para selecionar os envolvidos...')
                    .setMinValues(1)
                    .setMaxValues(10);

                const rowUsuarios = new ActionRowBuilder().addComponents(menuUsuarios);

                return interaction.reply({ embeds: [embedFiltro], components: [rowUsuarios] });
            }

            // BOTÃO: Veredicto Deferido (Abre seleção de advertências OU processa revogação direto)
            if (customId === 'btn_final_deferido') {
                const dadosCaso = memoriaFechamento.get(channelId);
                
                // Se for um processo de revogação, o "Deferido" significa RETIRAR a punição imediatamente
                if (dadosCaso && dadosCaso.isRevogacao) {
                    let canalResultados = guild.channels.cache.get(ID_CANAL_RESULTADOS);
                    const numeroFinalDoCaso = obterProximoCaso();
                    const ID_CANAL_TRANSCRIPTS = "1565194110199930971";
                    const ID_CARGO_GERAL_ADV = "13947740627062874"; 

                    const idMembro = dadosCaso.envolvidos[0];
                                        try {
                        const membroAlvo = await guild.members.fetch(idMembro).catch(() => null);
                        if (membroAlvo) {
                            // 1. CONVERTENDO O VALOR DA MEMÓRIA EM ARRAY CASO VENHA COMO VALOR ÚNICO
                            const cargosParaRemover = Array.isArray(dadosCaso.cargoParaRemover) 
                                ? dadosCaso.cargoParaRemover 
                                : [dadosCaso.cargoParaRemover];

                            // 2. ADICIONADO: REMOVE CADA UM DOS CARGOS ESPECÍFICOS DE ADVERTÊNCIA SELECIONADOS NO INÍCIO
                            for (const idCargo of cargosParaRemover) {
                                await membroAlvo.roles.remove(idCargo).catch(err => 
                                    console.error(`Erro ao remover cargo específico ${idCargo}:`, err)
                                );
                            }

                            // 3. Remove o cargo de advertência geral do servidor
                            await membroAlvo.roles.remove(ID_CARGO_GERAL_ADV).catch(() => {});
                        }
                    } catch (err) { 
                        console.error("Erro geral ao processar remoção de cargos na revogação:", err); 
                    }

                    const textoMensagem = 
                        `### ⚖️ REVOGAÇÃO DEFERIDA + #${numeroFinalDoCaso}\n` +
                        `> **STATUS JURÍDICO:** SENTENÇA REFORMADA (PUNIÇÃO REVOGADA)\n\n` +
                        `A Corregedoria Geral, após revisar a contestação submetida pelo colaborador, determinou o **DEFERIMENTO** do pedido. As sanções anteriores foram anuladas e removidas de sua ficha funcional.\n\n` +
                        `👤 **Cidadão Beneficiado:** <@${interaction.user.id}>\n` +
                        `❌ **Sanção Retirada:** <@&${dadosCaso.cargoParaRemover}>\n\n` +
                        `✍ *Corregedor Responsável:* <@${interaction.user.id}> — <t:${Math.floor(Date.now() / 1000)}:R>`;

                    if (canalResultados) {
                        await canalResultados.send({ content: `🔔 **Aviso de Revogação:** <@${idMembro}>\n\n${textoMensagem}` }).catch(err => console.error(err));
                    }

                                        // ENVIO DO LOG SIMPLIFICADO DE REVOGAÇÃO DEFERIDA (ACEITA)
                    try {
                        const canalLogsRevogacao = await guild.channels.fetch('1529134489341788421').catch(() => null);
                        if (canalLogsRevogacao) {
                            const textoLogRevogacao = 
                                `### 📝 REVOGAÇÃO DEFERIDA (PUNIÇÃO RETIRADA)\n` +
                                `**QRA:** <@${idMembro}>\n` +
                                `**MOTIVO:** Revisão aprovada no Caso #${numeroFinalDoCaso}\n` +
                                `**ADVERTÊNCIA RETIRADA:** <@&${dadosCaso.cargoParaRemover}>\n` +
                                `**STATUS:** Cargo removido com sucesso da ficha funcional.\n` +
                                `**CORREGEDOR RESPONSÁVEL:** <@${interaction.user.id}>`;

                            await canalLogsRevogacao.send({ content: textoLogRevogacao }).catch(err => console.error("Erro ao enviar log de revogação deferida:", err));
                        }
                    } catch (err) { console.error("Erro no canal de logs de revogação:", err); }


                    // Gera o Transcript em segundo plano
                    try {
                        const mensagens = await interaction.channel.messages.fetch({ limit: 100 });
                        let conteudoTexto = `=== TRANSCRIPT OFICIAL - REVOGAÇÃO ACEITA #${numeroFinalDoCaso} ===\n`;
                        msgOrdenadas = mensagens.reverse();
                        msgOrdenadas.forEach(m => { conteudoTexto += `[${m.createdAt.toLocaleTimeString('pt-BR')}] ${m.author.tag}: ${m.content}\n`; });
                        const bufferTexto = Buffer.from(conteudoTexto, 'utf-8');
                        const canalAuditoria = guild.channels.cache.get(ID_CANAL_TRANSCRIPTS);
                        if (canalAuditoria) await canalAuditoria.send({ content: `📁 **Logs de Revogação:** Caso \`#${numeroFinalDoCaso}\` deferido por ${interaction.user}.`, files: [{ attachment: bufferTexto, name: `revogacao-${numeroFinalDoCaso}.txt` }] });
                    } catch (e) { console.error(e); }

                    await interaction.update({ content: `🔒 **Revogação Processada com Sucesso!** Cargo removido e logs salvos.\n⚠️ *Este canal será deletado em 10 segundos.*`, embeds: [], components: [] });
                    memoriaFechamento.delete(channelId);
                    return setTimeout(() => interaction.channel.delete().catch(() => {}), 10000);
                }

                // Fluxo normal de ticket de denúncia (abrir menu de punições)
                const menuAdvs = new StringSelectMenuBuilder()
                    .setCustomId('menu_advertencias_multiplas')
                    .setPlaceholder('Selecione uma ou mais advertências...')
                    .setMinValues(1)
                    .setMaxValues(config.opcoesPunicao.length)
                    .addOptions(config.opcoesPunicao);

                const rowAdvs = new ActionRowBuilder().addComponents(menuAdvs);
                return interaction.update({ content: '🚨 **Selecione as punições aplicáveis abaixo:**', embeds: [], components: [rowAdvs] });
            }

            // BOTÃO: Veredicto Indeferido (Texto Elaborado + Transcript + Delete em 10s)
            if (customId === 'btn_final_indeferido') {
                const dadosCaso = memoriaFechamento.get(channelId);
                const canalResultados = guild.channels.cache.get(ID_CANAL_RESULTS) || guild.channels.cache.get(ID_CANAL_RESULTADOS);
                const numeroFinalDoCaso = obterProximoCaso();
                const ID_CANAL_TRANSCRIPTS = "1565194110199930971";

                if (dadosCaso && canalResultados) {
                    const idMembro = dadosCaso.envolvidos[0];
                    
                    // Se for um caso de revogação negada (Indeferida)
                    if (dadosCaso.isRevogacao) {
                        const textoMensagemIndeferido = 
                                                    `### 🏛️ REVOGAÇÃO INDEFERIDA + #${numeroFinalDoCaso}\n` +
                        `> **STATUS JURÍDICO:** CONTESTAÇÃO REJEITADA (PUNIÇÃO MANTIDA)\n\n` +
                        `A Corregedoria Geral avaliou os fundamentos do pedido de revisão e determinou o seu **INDEFERIMENTO**. As provas funcionais aplicadas originalmente são válidas e permanecem ativas.\n\n` +
                        `👤 **Colaborador:** <@${interaction.user.id}>\n` +
                        `⚠️ **Manutenção da Sanção:** <@&${dadosCaso.cargoParaRemover}>\n\n` +
                        `✍️ *Relator Responsável:* <@${interaction.user.id}> — <t:${Math.floor(Date.now() / 1000)}:R>`;

                    await canalResultados.send({ content: `🔔 **Notificação de Julgamento:** <@${idMembro}>\n\n${textoMensagemIndeferido}` });
                } else {
                    // Denúncia comum arquivada
                    const listaMencionados = dadosCaso.envolvidos.map(id => `<@${id}>`).join(', ');
                    const textoMensagemIndeferido = 
                        `### 🏛️ INDEFERIDO + #${numeroFinalDoCaso}\n` +
                        `> **STATUS JURÍDICO:** SENTENÇA INDEFERIDA (IMPROCEDENTE)\n\n` +
                        `A Corregedoria Geral da Cidade, após análise detida dos fatos narrados e verificação da idoneidade material trazida aos autos do chamado, declara o processo **ARQUIVADO**.\n\n` +
                        `👤 **Membros Citados:** ${listaMencionados}\n\n` +
                        `⚠️ **Fundamentação da Recusa:**\n` +
                        `A postulação não reuniu condições minima de admissibilidade, sendo rejeitada por **total ausência de elementos probatórios concretos** ou por incompatibilidade técnica com o regimento.\n\n` +
                        `✍️ *Relator Responsável:* \`${interaction.user.tag}\` — <t:${Math.floor(Date.now() / 1000)}:R>`;

                    await canalResultados.send({ content: `🔔 **Notificação de Arquivamento:** ${listaMencionados}\n\n${textoMensagemIndeferido}` });
                }
            }

            try {
                const mensagens = await interaction.channel.messages.fetch({ limit: 100 });
                let conteudoTexto = `=== TRANSCRIPT OFICIAL DE ATENDIMENTO - CASO INDEFERIDO #${numeroFinalDoCaso} ===\n`;
                const msgOrdenadas = mensagens.reverse();
                msgOrdenadas.forEach(m => { conteudoTexto += `[${m.createdAt.toLocaleTimeString('pt-BR')}] ${m.author.tag}: ${m.content}\n`; });
                const bufferTexto = Buffer.from(conteudoTexto, 'utf-8');
                const canalAuditoria = guild.channels.cache.get(ID_CANAL_TRANSCRIPTS);
                if (canalAuditoria) await canalAuditoria.send({ content: `📁 **Histórico:** Caso \`#${numeroFinalDoCaso}\` finalizado por ${interaction.user}.`, files: [{ attachment: bufferTexto, name: `transcript-${numeroFinalDoCaso}.txt` }] });
            } catch (e) { console.error(e); }

            await interaction.update({ content: `🔒 **Caso Indeferido com Sucesso!** Relatório publicado e enviado para a auditoria.\n⚠️ *Este canal será permanentemente deletado em 10 segundos.*`, embeds: [], components: [] });
            memoriaFechamento.delete(channelId);
            return setTimeout(() => interaction.channel.delete().catch(() => {}), 10000);
        }

        // --- LÓGICA DE CRIAÇÃO DE NOVOS TICKETS PRIVADOS ---
        let nomeCanal = "";
        let cargoAcessoId = "";
        let embedTicket = new EmbedBuilder();
        let mencaoCargo = "";

        if (customId === 'btn_corregedoria') {
            nomeCanal = `⚖️-corregedoria-${user.username}`;
            cargoAcessoId = config.idCargoCorregedor || "";
            mencaoCargo = cargoAcessoId ? `<@&${cargoAcessoId}>` : "@Corregedoria";

            embedTicket
                .setTitle("⚖️ CORREGEDORIA GERAL DA CIDADE")
                .setDescription(
                    `Prezado(a) cidadão(ã) ${user},\n\n` +
                    `Você está no canal oficial de atendimento da **Corregedoria Geral**.\n\n` +
                    `⚠️ **Garantia de Sigilo:** Nos termos do regimento, todas as informações são confidenciais.\n\n` +
                    `Para iniciarmos a investigação, **envie abaixo as seguintes informações**:`
                )
                .addFields({ name: '📋 Formulário de Abertura', value: `• **Seu Passaporte (ID):**\n• **Nome ou ID do Oficial Envolvido:**\n• **Corporação/Organização:** (Ex: PM, PC)\n• **Relato Detalhado:**\n• **Link de Provas:** (Vídeo anexado no YouTube/Medal)` })
                .setColor(0xff0000)
                .setTimestamp();
        }

        if (customId === 'btn_revogacao') {
            nomeCanal = `📝-revogacao-${user.username}`;
            cargoAcessoId = config.idCargoStaff || "";
            mencaoCargo = cargoAcessoId ? `<@&${cargoAcessoId}>` : "@Staff";

            embedTicket
                .setTitle("📝 DEPARTAMENTO DE REVISÃO E REVOGAÇÃO")
                .setDescription(`Olá ${user},\n\nEste canal foi aberto para apresentar sua contestação formal de punições aplicadas no servidor.\n\nPreencha a sua ficha de defesa abaixo:`)
                .addFields({ name: '📋 Ficha de Contestação', value: `• **Seu Passaporte (ID):**\n• **Qual punição deseja revogar?**\n• **Quem aplicou a punição?**\n• **Sua Justificativa/Defesa:**` })
                .setColor(0x0000ff)
                .setTimestamp();
        }

        if (nomeCanal) {
            const regrasPermissao = [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
            ];

            if (cargoAcessoId && guild.roles.cache.has(cargoAcessoId)) {
                regrasPermissao.push({ id: cargoAcessoId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
            }

            try {
                const canalCriado = await guild.channels.create({
                    name: nomeCanal,
                    type: 0,
                    //parent: ID_CATEGORIA_TICKETS,
                    permissionOverwrites: regrasPermissao
                });

                await interaction.reply({ content: `✅ Seu canal administrativo foi aberto com sucesso em ${canalCriado}`, ephemeral: true });

                const rowFechar = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('btn_fechar_ticket').setLabel('🔒 Fechar Ticket').setStyle(ButtonStyle.Secondary)
                );

                const componentesEnvio = [rowFechar];

                if (customId === 'btn_corregedoria') {
                    const rowMenuCitar = new ActionRowBuilder().addComponents(
                        new UserSelectMenuBuilder()
                            .setCustomId('citar_participantes')
                            .setPlaceholder('⚖️ Selecione até 10 pessoas para a defesa')
                            .setMinValues(1)
                            .setMaxValues(10)
                    );
                    componentesEnvio.push(rowMenuCitar);
                }

                if (customId === 'btn_revogacao') {
                    const rowMenuRevogar = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('selecao_adv_para_revogar')
                            .setPlaceholder('🚨 Selecione qual advertência deseja revisar...')
                            .setMinValues(1)
                            .setMaxValues(1)
                            .addOptions(config.opcoesPunicao)
                    );
                    componentesEnvio.push(rowMenuRevogar);
                }

                await canalCriado.send({ content: mencaoCargo, embeds: [embedTicket], components: componentesEnvio });
            } catch (error) {
                console.error("Erro ao criar canal na categoria:", error);
                await interaction.reply({ content: "❌ Erro: Verifique se o Bot possui a permissão de 'Gerenciar Canais' na categoria alvo.", ephemeral: true });
            }
        }
    }

    // --- 3. GERENCIAMENTO DE SELEÇÃO DE MENUS ---
    if (interaction.isAnySelectMenu()) {
        const { customId, values, channelId, guild } = interaction;

        if (customId === 'selecao_adv_para_revogar') {
            const advEscolhidaId = values[0];
            memoriaFechamento.set(channelId, { 
                envolvidos: interaction.user.id, 
                cargoParaRemover: advEscolhidaId,
                isRevogacao: true 
            });

            return await interaction.reply({
                content: `✅ Você selecionou a advertência <@&${advEscolhidaId}> para revisão.\nPreencha os dados do formulário acima detalhadamente e aguarde a Corregedoria avaliar.`,
            });
        }

        if (customId === 'citar_participantes') {
            const temPermissao = config.idCargoCorregedor.some(id => interaction.member.roles.cache.has(id)) || 
                              interaction.member.permissions.has(PermissionFlagsBits.Administrator);

            if (!temPermissao) {
                return await interaction.reply({
                    content: `❌ Apenas membros da **Corregedoria** ou **Administradores** podem adicionar participantes a este ticket.`,
                    ephemeral: true
                });
            }

            await interaction.reply({ content: `🔄 Processando permissões e aplicando acessos...`, ephemeral: true });

            const usuariosSelecionados = interaction.users;
            const mencoes = usuariosSelecionados.map(user => `<@${user.id}>`).join(', ');
                            for (const [id, user] of usuariosSelecionados) {
                    await interaction.channel.permissionOverwrites.create(id, {
                        ViewChannel: true,
                        SendMessages: true,
                        ReadMessageHistory: true
                    }).catch(err => console.error(err));
                }

                const timestamp = Math.floor(Date.now() / 1000);
                
                return await interaction.channel.send({
                    content: `✍️ *Participante(s) Convocado(s):* ${mencoes} — por <@${interaction.user.id}> em <t:${timestamp}:R>\n\n` +
                             `⚠️ **Prezado(a)(s), você foi citado nesta corregedoria.** Fica por meio deste ato convocado(a) a apresentar sua defesa legal mediante os fatos e evidências apresentados na denúncia deste ticket.`
                });
            }

            // Etapa 1: Captura envolvidos marcados ao fechar ticket
            if (customId === 'selecao_membros_caso') {
                memoriaFechamento.set(channelId, { envolvidos: values });

                const embedEscolha = new EmbedBuilder()
                    .setTitle("⚖️ ESCOLHA O VEREDICTO FINAL")
                    .setDescription(`Membros selecionados:\n${values.map(id => `<@${id}>`).join('\n')}\n\nEscolha o desfecho deste atendimento técnico:`)
                    .setColor(0x2f3136);

                const rowEscolhas = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('btn_final_deferido').setLabel('✅ Deferido (Aplicar Punição)').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('btn_final_indeferido').setLabel('❌ Indeferido (Falta de Provas)').setStyle(ButtonStyle.Danger)
                );

                return interaction.update({ embeds: [embedEscolha], components: [rowEscolhas] });
            }
                        // Etapa 2: Abre o Modal Obrigatório para digitar o motivo da punição
            if (customId === 'menu_advertencias_multiplas') {
                const dadosCaso = memoriaFechamento.get(channelId);
                if (!dadosCaso) return interaction.reply({ content: "❌ Erro nas etapas de fechamento. Reabra o menu.", ephemeral: true });

                // Salva temporariamente os cargos selecionados no menu para usar depois
                dadosCaso.cargosSelecionados = values;
                memoriaFechamento.set(channelId, dadosCaso);

                // Criando o Modal (Formulário Pop-up)
                const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
                
                const modal = new ModalBuilder()
                    .setCustomId('modal_motivo_punicao')
                    .setTitle('⚖️ Justificativa da Sentença');

                const inputMotivo = new TextInputBuilder()
                    .setCustomId('txt_motivo_detalhado')
                    .setLabel('Descrição/Motivo da Punição (Obrigatório)')
                    .setPlaceholder('Digite detalhadamente o motivo/artigo infringido...')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMinLength(10) // Evita que coloquem apenas pontinhos ou deixem em branco
                    .setMaxLength(1000)
                    .setRequired(true); // Torna o campo estritamente obrigatório

                const rowComponente = new ActionRowBuilder().addComponents(inputMotivo);
                modal.addComponents(rowComponente);

                // Abre o pop-up na tela do corregedor
                return await interaction.showModal(modal);
            }
            
        }
                // --- 4. RECEBIMENTO DO FORMULÁRIO (MODAL) ---
        if (interaction.isModalSubmit() && interaction.customId === 'modal_motivo_punicao') {
            const { channelId, guild, values } = interaction;
            const dadosCaso = memoriaFechamento.get(channelId);
            if (!dadosCaso) return interaction.reply({ content: "❌ Dados do caso expiraram ou não foram encontrados.", ephemeral: true });

            // Pega o texto obrigatório digitado pelo corregedor
            const motivoDigitado = interaction.fields.getTextInputValue('txt_motivo_detalhado');

            let canalResultados = guild.channels.cache.get(ID_CANAL_RESULTADOS);
            if (!canalResultados) {
                try { canalResultados = await guild.channels.fetch(ID_CANAL_RESULTADOS); } catch (e) {
                    canalResultados = guild.channels.cache.find(c => c.name === "resultados-corregedoria" || c.name === "logs-resultados");
                }
            }

            if (!canalResultados) return interaction.reply({ content: "❌ Erro: O canal de resultados não pôde ser localizado.", ephemeral: true });

            const numeroFinalDoCaso = obterProximoCaso();
            const ID_CARGO_GERAL_ADV = "13947740627062874"; 
            const ID_CANAL_TRANSCRIPTS = "1565194110199930971";

            // Procura dinamicamente os nomes dos cargos direto no config.json usando os IDs selecionados (values)
            const textoAdvsMarcadas = values.map(id => {
                const punicaoNoConfig = config.opcoesPunicao.find(opcao => opcao.value === id);
                return `• ${punicaoNoConfig ? punicaoNoConfig.label : id}`;
            }).join('\n');

            const cargosMarcados = dadosCaso.cargosSelecionados || [];

            for (const idMembro of dadosCaso.envolvidos) {
                try {
                    const membroAlvo = await guild.members.fetch(idMembro).catch(() => null);
                    if (membroAlvo) {
                        await membroAlvo.roles.add(ID_CARGO_GERAL_ADV).catch(() => {});
                        for (const idCargoPunicao of cargosMarcados) {
                            await membroAlvo.roles.add(idCargoPunicao).catch(() => {});
                        }
                    }
                } catch (err) { console.error(err); }

                const cargosMencionadosString = cargosMarcados.length > 0 
                    ? cargosMarcados.map(id => `<@&${id}>`).join(', ') 
                    : `<@&${ID_CARGO_GERAL_ADV}>`;

                const temposAdvsMarcadas = cargosMarcados.length > 0
                    ? cargosMarcados.map(id => {
                        const configPunicao = config.opcoesPunicao.find(o => o.value === id);
                        return configPunicao ? `• <@&${id}>: *${configPunicao.tempo}*` : '';
                      }).filter(t => t !== '').join('\n')
                    : `• <@&${ID_CARGO_GERAL_ADV}>: *Tempo padrão do regimento*`;

                // TEXTO OFICIAL COM O MOTIVO INSERIDO
                const textoMensagem = 
                    `### ⚖️ DEFERIDO + #${numeroFinalDoCaso}\n` +
                    `> **STATUS JURÍDICO:** SENTENÇA DEFERIDA (PROCEDENTE)\n\n` +
                    `O Departamento de Controle Interno e Corregedoria Geral concluiu a avaliação regulamentar do presente protocolo. Com base no acervo probatório e na apuração, foi constatado desvio formal de conduta.\n\n` +
                    `👤 **Infrator Penalizado:** <@${idMembro}>\n\n` +
                    `📝 **Motivação Técnico-Regulamentar:**\n> ${motivoDigitado}\n\n` +
                    `⚠️ **Sanções Regimentais Aplicadas:**\n${cargosMencionadosString}\n\n` +
                    `*Determina-se a averbação imediata deste veredicto na ficha funcional do servidor.*\n\n` +
                    `✍️ *Relator Responsible:* <@${interaction.user.id}> — <t:${Math.floor(Date.now() / 1000)}:R>`;

                await canalResultados.send({ content: `🔔 **Citação Processual:** <@${idMembro}>\n\n${textoMensagem}` }).catch(err => console.error(err));

                // SEU BLOCO ESPECÍFICO DE LOG ATUALIZADO COM O CAMPO DE TEXTO DO MOTIVO
                try {
                    const canalLogsEspecifico = await guild.channels.fetch('1529134407330562239').catch(() => null);
                    if (canalLogsEspecifico) {
                        const textoLogSimplificado = 
                            `**QRA:** <@${idMembro}>\n` +
                            `**MOTIVO HISTÓRICO:** Caso corregedoria #${numeroFinalDoCaso}\n` +
                            `**MOTIVO:** ${motivoDigitado}\n` + // O novo campo inserido aqui!
                            `**ADVERTÊNCIA APLICADA:** ${cargosMencionadosString}\n` +
                            `**TEMPO DE VIGÊNCIA:** ${temposAdvsMarcadas}\n` +
                            `**RESPONSÁVEL:** <@${interaction.user.id}>`;

                        await canalLogsEspecifico.send({ content: textoLogSimplificado }).catch(err => console.error(err));
                    }
                } catch (err) { console.error(err); }
            }

            // Transcripts e encerramento
            try {
                const mensagens = await interaction.channel.messages.fetch({ limit: 100 });
                let conteudoTexto = `=== TRANSCRIPT OFICIAL DE ATENDIMENTO - CASO #${numeroFinalDoCaso} ===\nMotivo da Decisão: ${motivoDigitado}\n\n`;
                const msgOrdenadas = mensagens.reverse();
                msgOrdenadas.forEach(m => { conteudoTexto += `[${m.createdAt.toLocaleTimeString('pt-BR')}] ${m.author.tag}: ${m.content}\n`; });
                const bufferTexto = Buffer.from(conteudoTexto, 'utf-8');
                const canalAuditoria = guild.channels.cache.get(ID_CANAL_TRANSCRIPTS);
                if (canalAuditoria) await canalAuditoria.send({ content: `📁 **Histórico de Arquivamento:** Caso \`#${numeroFinalDoCaso}\` finalizado por ${interaction.user}.`, files: [{ attachment: bufferTexto, name: `transcript-caso-${numeroFinalDoCaso}.txt` }] });
            } catch (errTranscript) { console.error(errTranscript); }

                        // =====================================================================
            // 🔒 FECHAMENTO CORRIGIDO PARA FORMULÁRIOS (MODAL)
            // =====================================================================
            // Envia a resposta final confirmando o sucesso e iniciando a contagem de 10s
            await interaction.reply({ 
                content: `🔒 **Caso Deferido com Sucesso!** Veredicto publicado, justificativa anexada e histórico salvo.\n⚠️ *Este canal será permanentemente deletado em 10 segundos.*`, 
                embeds: [], 
                components: [] 
            }).catch(() => {});

            memoriaFechamento.delete(channelId);
            
            // Inicia o cronômetro nativo de 10 segundos para deletar o canal do ticket
            return setTimeout(() => {
                interaction.channel.delete().catch(() => {});
            }, 10000);
            // =====================================================================

        }
    },
};



